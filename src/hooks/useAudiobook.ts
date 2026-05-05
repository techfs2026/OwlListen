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
  openBook: (path: string) => Promise<void>;
  play: () => void;
  pause: () => void;
  seekInChapter: (sec: number) => void;
  goToChapter: (index: number, positionSec?: number) => void;
  nextChapter: () => void;
  prevChapter: () => void;
  setSpeed: (s: Speed) => void;
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
  const chapterIndexRef = useRef(0);
  const lastSavedAtRef = useRef(0);
  const metaRef = useRef<AudiobookMeta | null>(null);
  useEffect(() => { metaRef.current = meta; }, [meta]);

  // 监听后端进度推送
  useEffect(() => {
    let unlisten: UnlistenFn | undefined;
    listen<PlaybackProgressEvent>("playback-progress", (event) => {
      const { chapterIndex, positionSec, playing } = event.payload;
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
    listen<{ chapterIndex: number }>("playback-chapter-ended", (event) => {
      console.log(`[audiobook] chapter ${event.payload.chapterIndex} ended`);
      // 主动暂停后端，停止音频时钟空转
      playbackPause().catch(() => { });
      setPlayState("paused");
    }).then((fn) => { unlisten = fn; });
    return () => { unlisten?.(); };
  }, []);

  const openBook = useCallback(async (path: string) => {
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
      setCurrentTime(posSec);

      // 启动后端引擎（不自动播放）
      await playbackOpen(path, chIdx, posSec);
      setPlayState("ready");
    } catch (err) {
      console.error("[audiobook] open failed:", err);
      setPlayState("idle");
    }
  }, []);

  const play = useCallback(() => {
    playbackPlay().catch((e) => console.error("[audiobook] play:", e));
  }, []);

  const pause = useCallback(() => {
    playbackPause().catch((e) => console.error("[audiobook] pause:", e));
    saveAudiobookProgress(bookPathRef.current, chapterIndexRef.current, 0)
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
    playbackSeek(clamped, positionSec)
      .catch((e) => console.error("[audiobook] goToChapter:", e));
  }, []);

  const nextChapter = useCallback(() => {
    const meta = metaRef.current;
    if (!meta) return;
    const next = chapterIndexRef.current + 1;
    if (next < meta.chapters.length) {
      playbackSeek(next, 0).catch((e) => console.error("[audiobook] next:", e));
    }
  }, []);

  const prevChapter = useCallback(() => {
    // 当前章节内已播超过 3 秒：回到本章开头；否则跳上一章
    if (currentTime > 3) {
      playbackSeek(chapterIndexRef.current, 0)
        .catch((e) => console.error("[audiobook] prev:", e));
    } else if (chapterIndexRef.current > 0) {
      playbackSeek(chapterIndexRef.current - 1, 0)
        .catch((e) => console.error("[audiobook] prev:", e));
    } else {
      playbackSeek(0, 0)
        .catch((e) => console.error("[audiobook] prev:", e));
    }
  }, [currentTime]);

  const setSpeed = useCallback((s: Speed) => {
    setSpeedState(s);
    playbackSetSpeed(s).catch((e) => console.error("[audiobook] setSpeed:", e));
  }, []);

  // 卸载时关闭引擎
  useEffect(() => {
    return () => { playbackClose().catch(() => { }); };
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