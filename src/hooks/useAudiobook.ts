import { useState, useCallback, useRef, useEffect } from "react";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import {
  loadAudiobook,
  getAudiobookProgress,
  saveAudiobookProgress,
  getRecentAudiobooks,
  pushRecentAudiobook,
  playbackOpen,
  playbackPlay,
  playbackPause,
  playbackClose,
  playbackSeek,
  playbackSetSpeed,
  type AudiobookMeta,
  type Chapter,
  type RecentBook,
  type PlaybackProgressEvent,
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
  recentBooks: RecentBook[];
  autoAdvance: boolean;
  error: string | null;
  openBook: (path: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  seekInChapter: (sec: number) => void;
  goToChapter: (index: number, positionSec?: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  setSpeed: (s: Speed) => void;
  setAutoAdvance: (v: boolean) => void;
  clearError: () => void;
}

export function useAudiobook(): UseAudiobookReturn {
  const [meta, setMeta] = useState<AudiobookMeta | null>(null);
  const [bookPath, setBookPath] = useState("");
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [currentChapterIndex, setCurrentChapterIndex] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [speed, setSpeedState] = useState<Speed>(1);
  const [recentBooks, setRecentBooks] = useState<RecentBook[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [autoAdvance, setAutoAdvanceState] = useState<boolean>(
    () => localStorage.getItem("audiobook.autoAdvance") !== "false"
  );

  const currentTimeRef = useRef(0);
  const speedRef = useRef<Speed>(1);
  const bookPathRef = useRef("");
  const chapterIndexRef = useRef(0);
  const lastSavedAtRef = useRef(0);
  const metaRef = useRef<AudiobookMeta | null>(null);
  useEffect(() => { metaRef.current = meta; }, [meta]);
  const autoAdvanceRef = useRef(autoAdvance);
  useEffect(() => { autoAdvanceRef.current = autoAdvance; }, [autoAdvance]);

  // 监听后端进度推送
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<PlaybackProgressEvent>("playback-progress", (event) => {
      const { chapterIndex, positionSec, playing } = event.payload;
      currentTimeRef.current = positionSec;
      chapterIndexRef.current = chapterIndex;
      setCurrentChapterIndex(chapterIndex);
      setCurrentTime(positionSec);
      setPlayState(playing ? "playing" : "paused");

      // 节流保存
      const now = Date.now();
      if (playing && now - lastSavedAtRef.current > SAVE_INTERVAL_MS) {
        lastSavedAtRef.current = now;
        saveAudiobookProgress(bookPathRef.current, chapterIndex, positionSec)
          .catch(() => { });
      }
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  useEffect(() => {
    getRecentAudiobooks().then(setRecentBooks).catch(() => { });
  }, []);

  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<{ chapterIndex: number }>("playback-chapter-ended", () => {
      const meta = metaRef.current;
      const cur = chapterIndexRef.current;
      const hasNext = !!meta && cur < meta.chapters.length - 1;

      // 自动续播开关开 且 还有下一章：直接跳下一章继续放（cpal 流仍在播，
      // seek 会让解码线程从下一章重填环，无需重新 play）。
      if (autoAdvanceRef.current && hasNext) {
        const next = cur + 1;
        chapterIndexRef.current = next;
        currentTimeRef.current = 0;
        setCurrentChapterIndex(next);
        setCurrentTime(0);
        setPlayState("playing");
        playbackSeek(next, 0)
          .then(() => {
            if (speedRef.current !== 1) return playbackSetSpeed(speedRef.current);
          })
          .catch((e) => console.error("[audiobook] auto-advance:", e));
        return;
      }

      // 否则（关了续播，或已是最后一章）：停在章末，暂停后端避免空转
      playbackPause().catch(() => { });
      setPlayState("paused");
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  // 后端解码出错 → 提示用户（否则只会静默冻住）
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<{ message: string }>("playback-error", (event) => {
      console.error("[audiobook] playback error:", event.payload.message);
      setError("播放出错，音频可能已损坏。请重新打开或换一本。");
      setPlayState("paused");
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const openBook = useCallback(async (path: string) => {
    setPlayState("loading");
    setError(null);
    setCurrentTime(0);
    setCurrentChapterIndex(0);
    setMeta(null);

    try {
      const [bookMeta, progress] = await Promise.all([
        loadAudiobook(path),
        getAudiobookProgress(path),
      ]);

      bookPathRef.current = path;
      setBookPath(path);
      setMeta(bookMeta);

      pushRecentAudiobook(path, bookMeta.title, bookMeta.author)
        .then(() => getRecentAudiobooks())
        .then(setRecentBooks)
        .catch(() => { });

      const chIdx = Math.min(progress.chapterIndex, bookMeta.chapters.length - 1);
      const posSec = progress.positionSec;
      currentTimeRef.current = posSec;
      chapterIndexRef.current = chIdx;
      setCurrentChapterIndex(chIdx);
      setCurrentTime(posSec);

      // 启动后端引擎（不自动播放）
      await playbackOpen(path, chIdx, posSec);

      const currentSpeed = speedRef.current;
      if (currentSpeed !== 1) {
        await playbackSetSpeed(currentSpeed).catch(() => {});
      }

      setPlayState("ready");
    } catch (err) {
      console.error("[audiobook] open failed:", err);
      setError("无法打开有声书，文件可能已损坏或被移动。");
      setPlayState("idle");
    }
  }, []);

  const play = useCallback(() => {
    playbackPlay().catch((e) => console.error("[audiobook] play:", e));
  }, []);

  const pause = useCallback(() => {
    playbackPause().catch((e) => console.error("[audiobook] pause:", e));
    saveAudiobookProgress(bookPathRef.current, chapterIndexRef.current, currentTimeRef.current)
      .catch(() => { });
  }, []);

  const seekInChapter = useCallback((sec: number) => {
    playbackSeek(chapterIndexRef.current, Math.max(0, sec))
      .catch((e) => console.error("[audiobook] seek:", e));
  }, []);

  const goToChapter = useCallback((index: number, positionSec = 0) => {
    const meta = metaRef.current;
    if (!meta) return;
    const clamped = Math.max(0, Math.min(index, meta.chapters.length - 1));
    // 主动更新前端 state，不依赖后端推事件（暂停/ready 状态后端不推）
    chapterIndexRef.current = clamped;
    currentTimeRef.current = positionSec;
    setCurrentChapterIndex(clamped);
    setCurrentTime(positionSec);
    playbackSeek(clamped, positionSec)
      .then(() => {
        // seek 完成后重新 apply 速率，防止后端重建管道时重置为 1x
        if (speedRef.current !== 1) {
          return playbackSetSpeed(speedRef.current);
        }
      })
      .catch((e) => console.error("[audiobook] goToChapter:", e));
  }, []);
  
  const nextChapter = useCallback(() => {
    const meta = metaRef.current;
    if (!meta) return;
    const next = chapterIndexRef.current + 1;
    if (next < meta.chapters.length) {
      chapterIndexRef.current = next;
      currentTimeRef.current = 0;
      setCurrentChapterIndex(next);
      setCurrentTime(0);
      playbackSeek(next, 0)
        .then(() => {
          if (speedRef.current !== 1) {
            return playbackSetSpeed(speedRef.current);
          }
        })
        .catch((e) => console.error("[audiobook] next:", e));
    }
  }, []);
  
  const prevChapter = useCallback(() => {
    const applySpeed = () => {
      if (speedRef.current !== 1) {
        playbackSetSpeed(speedRef.current).catch(() => {});
      }
    };
  
    if (currentTimeRef.current > 3) {
      currentTimeRef.current = 0;
      setCurrentTime(0);
      playbackSeek(chapterIndexRef.current, 0)
        .then(applySpeed)
        .catch((e) => console.error("[audiobook] prev:", e));
    } else if (chapterIndexRef.current > 0) {
      const prev = chapterIndexRef.current - 1;
      chapterIndexRef.current = prev;
      currentTimeRef.current = 0;
      setCurrentChapterIndex(prev);
      setCurrentTime(0);
      playbackSeek(prev, 0)
        .then(applySpeed)
        .catch((e) => console.error("[audiobook] prev:", e));
    } else {
      currentTimeRef.current = 0;
      setCurrentTime(0);
      playbackSeek(0, 0)
        .then(applySpeed)
        .catch((e) => console.error("[audiobook] prev:", e));
    }
  }, []);

  const setSpeed = useCallback((s: Speed) => {
    speedRef.current = s;
    setSpeedState(s);
    playbackSetSpeed(s).catch((e) => console.error("[audiobook] setSpeed:", e));
  }, []);

  const setAutoAdvance = useCallback((v: boolean) => {
    setAutoAdvanceState(v);
    localStorage.setItem("audiobook.autoAdvance", String(v));
  }, []);

  const clearError = useCallback(() => setError(null), []);

  // 卸载时关闭引擎
  useEffect(() => {
    return () => { playbackClose().catch(() => { }); };
  }, []);

  const currentChapter = meta?.chapters[currentChapterIndex] ?? null;

  return {
    meta, bookPath, playState,
    currentChapter, currentChapterIndex, currentTime, speed,
    recentBooks, autoAdvance, error,
    openBook, play, pause, seekInChapter,
    goToChapter, nextChapter, prevChapter, setSpeed,
    setAutoAdvance, clearError,
  };
}