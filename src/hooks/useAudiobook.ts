import { useState, useCallback, useRef, useEffect } from "react";
import {
  loadAudiobook,
  getAudiobookProgress,
  saveAudiobookProgress,
  toAssetUrl,
  type AudiobookMeta,
  type Chapter,
} from "@/utils/audiobookApi";

export type PlayState = "idle" | "loading" | "ready" | "playing" | "paused";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75] as const;
export type Speed = typeof SPEEDS[number];

const SAVE_INTERVAL_MS = 5000;

export interface UseAudiobookReturn {
  meta: AudiobookMeta | null;
  bookPath: string;
  playState: PlayState;
  currentChapter: Chapter | null;
  currentChapterIndex: number;
  currentTime: number;
  speed: Speed;
  openBook: (path: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  seekInChapter: (sec: number) => void;
  goToChapter: (index: number, positionSec?: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  setSpeed: (s: Speed) => void;
}

let globalCtx: AudioContext | null = null;
function getCtx(): AudioContext {
  if (!globalCtx || globalCtx.state === "closed") globalCtx = new AudioContext();
  return globalCtx;
}

// m4b 是单个大文件，整本书解码一次缓存
// key = 文件路径
const bookCache = new Map<string, AudioBuffer>();

export function useAudiobook(): UseAudiobookReturn {
  const [meta, setMeta] = useState<AudiobookMeta | null>(null);
  const [bookPath, setBookPath] = useState("");
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeedState] = useState<Speed>(1);

  const bookPathRef        = useRef("");
  const metaRef            = useRef<AudiobookMeta | null>(null);
  const chapterIndexRef    = useRef(0);
  const sourceRef          = useRef<AudioBufferSourceNode | null>(null);
  const offsetRef          = useRef(0);   // 全局秒数（相对整本书）
  const startCtxTimeRef    = useRef(0);
  const isPlayingRef       = useRef(false);
  const rafRef             = useRef(0);
  const speedRef           = useRef<Speed>(1);
  const saveTimerRef       = useRef<ReturnType<typeof setInterval> | null>(null);
  // 用于打破 goToChapter ↔ onended 循环依赖
  const jumpRef            = useRef<(globalSec: number) => void>(() => {});

  // ── 工具 ──────────────────────────────────────────────────────────────────

  const stopSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try { sourceRef.current.stop(); } catch (_) {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current) { cancelAnimationFrame(rafRef.current); rafRef.current = 0; }
  }, []);

  const stopSaveTimer = useCallback(() => {
    if (saveTimerRef.current) { clearInterval(saveTimerRef.current); saveTimerRef.current = null; }
  }, []);

  // 当前全局播放位置（秒）
  const globalPos = useCallback((): number => {
    if (!isPlayingRef.current) return offsetRef.current;
    const ctx = getCtx();
    const elapsed = (ctx.currentTime - startCtxTimeRef.current) * speedRef.current;
    return offsetRef.current + Math.max(0, elapsed);
  }, []);

  // 全局秒 → 章节索引
  const secToChapter = useCallback((globalSec: number): number => {
    const chapters = metaRef.current?.chapters ?? [];
    for (let i = chapters.length - 1; i >= 0; i--) {
      if (globalSec >= chapters[i].startSec) return i;
    }
    return 0;
  }, []);

  // tick：rAF 驱动 currentTime + chapter index
  const tick = useCallback(() => {
    if (!isPlayingRef.current) return;
    const pos = globalPos();
    const chIdx = secToChapter(pos);
    const chapter = metaRef.current?.chapters[chIdx];
    const chTime = chapter ? pos - chapter.startSec : pos;
    setCurrentTime(chTime);
    if (chIdx !== chapterIndexRef.current) {
      chapterIndexRef.current = chIdx;
      setCurrentChapterIndex(chIdx);
    }
    rafRef.current = requestAnimationFrame(tick);
  }, [globalPos, secToChapter]);

  // ── 解码整本书 ────────────────────────────────────────────────────────────

  const decodeBook = useCallback(async (path: string): Promise<AudioBuffer> => {
    if (bookCache.has(path)) return bookCache.get(path)!;
    const ctx = getCtx();
    const resp = await fetch(toAssetUrl(path));
    if (!resp.ok) throw new Error(`fetch failed: ${resp.status}`);
    const buf = await ctx.decodeAudioData(await resp.arrayBuffer());
    bookCache.set(path, buf);
    return buf;
  }, []);

  // ── 核心播放（全局秒数定位）──────────────────────────────────────────────

  const startPlayback = useCallback((buffer: AudioBuffer, fromGlobalSec: number) => {
    const ctx = getCtx();
    if (ctx.state === "suspended") ctx.resume().catch(() => {});

    stopSource();
    stopRaf();

    const from = Math.max(0, Math.min(fromGlobalSec, buffer.duration));
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.playbackRate.value = speedRef.current;
    src.connect(ctx.destination);

    src.onended = () => {
      if (!isPlayingRef.current) return;
      // 自然播完整本书
      isPlayingRef.current = false;
      stopRaf();
      setPlayState("ready");
      saveAudiobookProgress(bookPathRef.current, 0, 0).catch(() => {});
    };

    src.start(0, from);
    sourceRef.current = src;
    offsetRef.current = from;
    startCtxTimeRef.current = ctx.currentTime;
    isPlayingRef.current = true;
    setPlayState("playing");

    // 立刻更新章节显示
    const chIdx = secToChapter(from);
    const chapter = metaRef.current?.chapters[chIdx];
    chapterIndexRef.current = chIdx;
    setCurrentChapterIndex(chIdx);
    setCurrentTime(chapter ? from - chapter.startSec : from);

    rafRef.current = requestAnimationFrame(tick);
  }, [stopSource, stopRaf, tick, secToChapter]);

  // jumpRef 始终指向最新的 startPlayback + buffer
  // 用于在 openBook 后由外部调用跳转
  const bufferRef = useRef<AudioBuffer | null>(null);
  useEffect(() => {
    jumpRef.current = (globalSec: number) => {
      if (bufferRef.current) startPlayback(bufferRef.current, globalSec);
    };
  }, [startPlayback]);

  // ── 进度自动保存 ──────────────────────────────────────────────────────────

  const startSaveTimer = useCallback(() => {
    stopSaveTimer();
    saveTimerRef.current = setInterval(() => {
      if (!isPlayingRef.current) return;
      const pos = globalPos();
      const chIdx = secToChapter(pos);
      saveAudiobookProgress(bookPathRef.current, chIdx, pos - (metaRef.current?.chapters[chIdx]?.startSec ?? 0))
        .catch(() => {});
    }, SAVE_INTERVAL_MS);
  }, [stopSaveTimer, globalPos, secToChapter]);

  // ── 公开 API ──────────────────────────────────────────────────────────────

  const openBook = useCallback(async (path: string) => {
    stopSource();
    stopRaf();
    stopSaveTimer();
    isPlayingRef.current = false;
    bookCache.delete(path); // 强制重新加载
    setPlayState("loading");
    setCurrentTime(0);
    setCurrentChapterIndex(0);
    setMeta(null);

    try {
      const [bookMeta, progress] = await Promise.all([
        loadAudiobook(path),
        getAudiobookProgress(path),
      ]);

      bookPathRef.current = path;
      metaRef.current = bookMeta;
      setBookPath(path);
      setMeta(bookMeta);

      // 恢复进度：章节 startSec + 章节内偏移
      const chIdx = Math.min(progress.chapterIndex, bookMeta.chapters.length - 1);
      const globalSec = (bookMeta.chapters[chIdx]?.startSec ?? 0) + progress.positionSec;

      chapterIndexRef.current = chIdx;
      setCurrentChapterIndex(chIdx);
      offsetRef.current = globalSec;
      setCurrentTime(progress.positionSec);

      setPlayState("loading"); // 显示解码进度
      const buffer = await decodeBook(path);
      bufferRef.current = buffer;
      setPlayState("ready");
      startSaveTimer();
    } catch (err) {
      console.error("[audiobook] open failed:", err);
      setPlayState("idle");
    }
  }, [stopSource, stopRaf, stopSaveTimer, decodeBook, startSaveTimer]);

  const play = useCallback(() => {
    const buf = bufferRef.current;
    if (!buf) return;
    startPlayback(buf, offsetRef.current);
  }, [startPlayback]);

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    const pos = globalPos();
    offsetRef.current = pos;
    isPlayingRef.current = false;
    stopSource();
    stopRaf();
    const chIdx = secToChapter(pos);
    const chTime = pos - (metaRef.current?.chapters[chIdx]?.startSec ?? 0);
    setCurrentTime(chTime);
    setPlayState("paused");
    saveAudiobookProgress(bookPathRef.current, chIdx, chTime).catch(() => {});
  }, [stopSource, stopRaf, globalPos, secToChapter]);

  const seekInChapter = useCallback((sec: number) => {
    const chIdx = chapterIndexRef.current;
    const chStart = metaRef.current?.chapters[chIdx]?.startSec ?? 0;
    const globalSec = chStart + Math.max(0, sec);
    offsetRef.current = globalSec;
    setCurrentTime(Math.max(0, sec));
    if (isPlayingRef.current && bufferRef.current) {
      startPlayback(bufferRef.current, globalSec);
    }
  }, [startPlayback]);

  const goToChapter = useCallback((index: number, positionSec = 0) => {
    const curMeta = metaRef.current;
    if (!curMeta) return;
    const clamped = Math.max(0, Math.min(index, curMeta.chapters.length - 1));
    const globalSec = (curMeta.chapters[clamped]?.startSec ?? 0) + positionSec;
    offsetRef.current = globalSec;
    chapterIndexRef.current = clamped;
    setCurrentChapterIndex(clamped);
    setCurrentTime(positionSec);
    if (isPlayingRef.current && bufferRef.current) {
      startPlayback(bufferRef.current, globalSec);
    }
  }, [startPlayback]);

  const nextChapter = useCallback(() => {
    const curMeta = metaRef.current;
    if (!curMeta) return;
    if (chapterIndexRef.current < curMeta.chapters.length - 1) {
      goToChapter(chapterIndexRef.current + 1, 0);
    }
  }, [goToChapter]);

  const prevChapter = useCallback(() => {
    if (chapterIndexRef.current > 0) goToChapter(chapterIndexRef.current - 1, 0);
    else seekInChapter(0);
  }, [goToChapter, seekInChapter]);

  const setSpeed = useCallback((s: Speed) => {
    // 先冻结当前全局位置，再换速率重新调度
    const pos = globalPos();
    offsetRef.current = pos;
    speedRef.current = s;
    setSpeedState(s);
    if (isPlayingRef.current && bufferRef.current) {
      startPlayback(bufferRef.current, pos);
    }
  }, [globalPos, startPlayback]);

  useEffect(() => {
    return () => { stopSource(); stopRaf(); stopSaveTimer(); };
  }, [stopSource, stopRaf, stopSaveTimer]);

  const currentChapter = meta?.chapters[currentChapterIndex] ?? null;

  return {
    meta, bookPath, playState,
    currentChapter, currentChapterIndex, currentTime, speed,
    openBook, play, pause, seekInChapter,
    goToChapter, nextChapter, prevChapter, setSpeed,
  };
}