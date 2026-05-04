import { useState, useCallback, useRef, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  loadAudiobook,
  getAudiobookProgress,
  saveAudiobookProgress,
  getRecentAudiobooks,
  pushRecentAudiobook,
  type AudiobookMeta,
  type Chapter,
  type RecentBook,
} from "@/utils/audiobookApi";

export type PlayState = "idle" | "loading" | "ready" | "playing" | "paused";

export const SPEEDS = [0.5, 0.75, 1, 1.25, 1.5, 1.75] as const;
export type Speed = typeof SPEEDS[number];

const SAVE_INTERVAL_MS = 5000;
// 内存中最多保留几章的 Blob URL（当前章 + 下一章）
const MAX_CACHED_CHAPTERS = 2;

export interface UseAudiobookReturn {
  meta: AudiobookMeta | null;
  bookPath: string;
  playState: PlayState;
  currentChapter: Chapter | null;
  currentChapterIndex: number;
  currentTime: number;
  speed: Speed;
  recentBooks: RecentBook[];
  openBook: (path: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  seekInChapter: (sec: number) => void;
  goToChapter: (index: number, positionSec?: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  setSpeed: (s: Speed) => void;
}

let globalAudio: HTMLAudioElement | null = null;
function getAudio(): HTMLAudioElement {
  if (!globalAudio) {
    globalAudio = new Audio();
    globalAudio.preservesPitch = true;
    // Safari 用的是带前缀的旧名，写一次保险
    (globalAudio as any).webkitPreservesPitch = true;
    (globalAudio as any).mozPreservesPitch = true;
  }
  return globalAudio;
}

// ── 章节级 Blob URL 缓存（LRU，最多 MAX_CACHED_CHAPTERS 条）──────────────────
// key: `${bookPath}::${chapterIndex}`

interface CacheEntry {
  url: string;       // Blob URL
  duration: number;  // 章节秒数
  lastUsed: number;  // Date.now()
}
const chapterCache = new Map<string, CacheEntry>();

function cacheKey(bookPath: string, idx: number) {
  return `${bookPath}::${idx}`;
}

function getCached(bookPath: string, idx: number): CacheEntry | null {
  const entry = chapterCache.get(cacheKey(bookPath, idx));
  if (!entry) return null;
  entry.lastUsed = Date.now();
  return entry;
}

function setCached(bookPath: string, idx: number, url: string, duration: number) {
  const key = cacheKey(bookPath, idx);
  // 同 key 旧条目先 revoke
  const existing = chapterCache.get(key);
  if (existing) URL.revokeObjectURL(existing.url);

  chapterCache.set(key, { url, duration, lastUsed: Date.now() });

  // LRU 驱逐
  while (chapterCache.size > MAX_CACHED_CHAPTERS) {
    let oldestKey = "";
    let oldestTime = Infinity;
    for (const [k, v] of chapterCache) {
      if (v.lastUsed < oldestTime) { oldestTime = v.lastUsed; oldestKey = k; }
    }
    if (!oldestKey) break;
    const old = chapterCache.get(oldestKey);
    if (old) URL.revokeObjectURL(old.url);
    chapterCache.delete(oldestKey);
  }
}

/** 切换书时调用：清掉所有非当前书的缓存，避免内存堆积。 */
function evictOtherBooks(currentBookPath: string) {
  for (const [key, entry] of chapterCache) {
    if (!key.startsWith(currentBookPath + "::")) {
      URL.revokeObjectURL(entry.url);
      chapterCache.delete(key);
    }
  }
}

async function loadChapterEntry(
  bookPath: string,
  chapter: Chapter,
  idx: number,
): Promise<CacheEntry> {
  const cached = getCached(bookPath, idx);
  if (cached) return cached;

  // Tauri Response::new(Vec<u8>) → ArrayBuffer，零拷贝
  const arrayBuffer = await invoke<ArrayBuffer>("export_chapter_slice", {
    path: bookPath,
    startSec: chapter.startSec,
    endSec: chapter.endSec,
  });

  // 直接做成 Blob URL，不再 decodeAudioData
  // type 用 audio/aac，浏览器据此选解码器
  const blob = new Blob([arrayBuffer], { type: "audio/aac" });
  const url = URL.createObjectURL(blob);
  const duration = chapter.endSec - chapter.startSec;

  setCached(bookPath, idx, url, duration);
  return { url, duration, lastUsed: Date.now() };
}

export function useAudiobook(): UseAudiobookReturn {
  const [meta, setMeta] = useState<AudiobookMeta | null>(null);
  const [bookPath, setBookPath] = useState("");
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeedState] = useState<Speed>(1);
  const [recentBooks, setRecentBooks] = useState<RecentBook[]>([]);

  const bookPathRef = useRef("");
  const metaRef = useRef<AudiobookMeta | null>(null);
  const chapterIndexRef = useRef(0);
  const speedRef = useRef<Speed>(1);
  /** 当前章节的 Blob URL（用于判断是否需要 reload audio.src） */
  const currentUrlRef = useRef<string | null>(null);
  /** 上一次保存进度的时间戳 */
  const lastSavedAtRef = useRef(0);
  /** 是否正在 seek（避免 timeupdate 反复触发保存）*/
  const seekingRef = useRef(false);

  useEffect(() => {
    const audio = getAudio();

    const onTimeUpdate = () => {
      // 拖动滑块期间不更新（防止抖动）
      if (seekingRef.current) return;
      setCurrentTime(audio.currentTime);

      // 节流保存进度
      const now = Date.now();
      if (!audio.paused && now - lastSavedAtRef.current > SAVE_INTERVAL_MS) {
        lastSavedAtRef.current = now;
        saveAudiobookProgress(
          bookPathRef.current,
          chapterIndexRef.current,
          audio.currentTime,
        ).catch(() => { });
      }
    };

    const onEnded = () => {
      // 章节自然结束：停在章节开头（你确认过不连播）
      setPlayState("paused");
      setCurrentTime(0);
      audio.currentTime = 0;
      saveAudiobookProgress(bookPathRef.current, chapterIndexRef.current, 0)
        .catch(() => { });
    };

    const onPlay = () => setPlayState("playing");
    const onPause = () => {
      // ended 事件也会触发 pause，让 onEnded 接管 paused 状态
      if (!audio.ended) setPlayState("paused");
    };

    const onError = () => {
      console.error("[audiobook] <audio> error:", audio.error);
      setPlayState("paused");
    };

    audio.addEventListener("timeupdate", onTimeUpdate);
    audio.addEventListener("ended", onEnded);
    audio.addEventListener("play", onPlay);
    audio.addEventListener("pause", onPause);
    audio.addEventListener("error", onError);

    return () => {
      audio.removeEventListener("timeupdate", onTimeUpdate);
      audio.removeEventListener("ended", onEnded);
      audio.removeEventListener("play", onPlay);
      audio.removeEventListener("pause", onPause);
      audio.removeEventListener("error", onError);
    };
  }, []);

  const loadIntoAudioElement = useCallback(
    (entry: CacheEntry, fromSec: number) => {
      const audio = getAudio();
      if (currentUrlRef.current !== entry.url) {
        audio.src = entry.url;
        currentUrlRef.current = entry.url;
        // 新 src 后必须等 loadedmetadata 才能可靠地 set currentTime
        // 但 currentTime 在 loadedmetadata 前赋值会被浏览器记住并应用，所以可直接设
      }
      const target = Math.max(0, Math.min(fromSec, entry.duration));
      // currentTime 直接赋值即可——浏览器会在 metadata ready 后应用
      audio.currentTime = target;
      audio.playbackRate = speedRef.current;
      audio.preservesPitch = true;
      setCurrentTime(target);
    },
    [],
  );

  const prefetchAdjacent = useCallback((idx: number) => {
    const chapters = metaRef.current?.chapters;
    if (!chapters) return;
    const path = bookPathRef.current;
    const next = idx + 1;
    if (next < chapters.length && !getCached(path, next)) {
      // 后台静默：失败不影响主流程
      loadChapterEntry(path, chapters[next], next).catch(() => { });
    }
  }, []);

  useEffect(() => {
    getRecentAudiobooks().then(setRecentBooks).catch(() => { });
  }, []);

  const openBook = useCallback(async (path: string) => {
    const audio = getAudio();
    audio.pause();

    evictOtherBooks(path);
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

      pushRecentAudiobook(path, bookMeta.title, bookMeta.author)
        .then(() => getRecentAudiobooks())
        .then(setRecentBooks)
        .catch(() => { });

      const chIdx = Math.min(progress.chapterIndex, bookMeta.chapters.length - 1);
      const posSec = progress.positionSec;

      chapterIndexRef.current = chIdx;
      setCurrentChapterIndex(chIdx);

      const entry = await loadChapterEntry(path, bookMeta.chapters[chIdx], chIdx);
      loadIntoAudioElement(entry, posSec);
      setPlayState("ready");

      prefetchAdjacent(chIdx);
    } catch (err) {
      console.error("[audiobook] open failed:", err);
      setPlayState("idle");
    }
  }, [loadIntoAudioElement, prefetchAdjacent]);

  const play = useCallback(() => {
    const audio = getAudio();
    if (!currentUrlRef.current) return;
    audio.playbackRate = speedRef.current;
    audio.preservesPitch = true;
    audio.play().catch((err) => {
      console.error("[audiobook] play failed:", err);
    });
    // playState 由 onPlay 事件更新
  }, []);

  const pause = useCallback(() => {
    getAudio().pause();
    // playState 由 onPause 事件更新
    // 暂停时立刻保存一次进度
    const audio = getAudio();
    saveAudiobookProgress(
      bookPathRef.current,
      chapterIndexRef.current,
      audio.currentTime,
    ).catch(() => { });
  }, []);

  const seekInChapter = useCallback((sec: number) => {
    const audio = getAudio();
    seekingRef.current = true;
    const clamped = Math.max(0, sec);
    audio.currentTime = clamped;
    setCurrentTime(clamped);
    // 让浏览器处理完 seek，再恢复 timeupdate 同步
    requestAnimationFrame(() => { seekingRef.current = false; });
  }, []);

  const goToChapter = useCallback(async (index: number, positionSec = 0) => {
    const curMeta = metaRef.current;
    if (!curMeta) return;

    const clamped = Math.max(0, Math.min(index, curMeta.chapters.length - 1));
    const chapter = curMeta.chapters[clamped];
    const audio = getAudio();
    const wasPlaying = !audio.paused;

    audio.pause();
    chapterIndexRef.current = clamped;
    setCurrentChapterIndex(clamped);

    const cached = getCached(bookPathRef.current, clamped);
    if (cached) {
      loadIntoAudioElement(cached, positionSec);
      if (wasPlaying) play();
      else setPlayState("ready");
      prefetchAdjacent(clamped);
      return;
    }

    setPlayState("loading");
    try {
      const entry = await loadChapterEntry(bookPathRef.current, chapter, clamped);
      // 若加载期间用户又切走了，放弃
      if (chapterIndexRef.current !== clamped) return;
      loadIntoAudioElement(entry, positionSec);
      if (wasPlaying) play();
      else setPlayState("ready");
      prefetchAdjacent(clamped);
    } catch (err) {
      console.error("[audiobook] goToChapter load failed:", err);
      setPlayState("idle");
    }
  }, [loadIntoAudioElement, prefetchAdjacent, play]);

  const nextChapter = useCallback(() => {
    const curMeta = metaRef.current;
    if (!curMeta) return;
    if (chapterIndexRef.current < curMeta.chapters.length - 1) {
      goToChapter(chapterIndexRef.current + 1, 0);
    }
  }, [goToChapter]);

  const prevChapter = useCallback(() => {
    const audio = getAudio();
    // 章节内已播超过 3 秒：回到开头；否则跳上一章
    if (audio.currentTime > 3) {
      seekInChapter(0);
    } else if (chapterIndexRef.current > 0) {
      goToChapter(chapterIndexRef.current - 1, 0);
    } else {
      seekInChapter(0);
    }
  }, [goToChapter, seekInChapter]);

  const setSpeed = useCallback((s: Speed) => {
    speedRef.current = s;
    setSpeedState(s);
    const audio = getAudio();
    audio.playbackRate = s;
    audio.preservesPitch = true; // 保险：某些浏览器在 src 切换后会重置
  }, []);

  useEffect(() => {
    return () => {
      // 组件卸载时停止播放，但不清空缓存（同次 app 生命周期内可复用）
      const audio = globalAudio;
      if (audio) audio.pause();
    };
  }, []);

  const currentChapter = meta?.chapters[currentChapterIndex] ?? null;

  return {
    meta, bookPath, playState,
    currentChapter, currentChapterIndex, currentTime, speed,
    recentBooks,
    openBook, play, pause, seekInChapter,
    goToChapter, nextChapter, prevChapter, setSpeed,
  };
}