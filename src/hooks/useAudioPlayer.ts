import { useState, useCallback, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

export type PlayState = "idle" | "loading" | "ready" | "playing" | "paused";

interface UseAudioPlayerReturn {
  playState: PlayState;
  currentTime: number;       // 当前播放位置（秒）
  duration: number;          // 音频总时长（秒）
  loadFile: (path: string) => Promise<void>;
  play: (fromSec?: number) => void;
  pause: () => void;
  seek: (sec: number) => void;
  toggle: () => void;
  unload: () => void;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Web Audio API 核心对象
  const ctxRef    = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // 播放状态追踪（ref 避免 RAF 回调里读到过时的 state）
  const isPlayingRef  = useRef(false);
  const startTimeRef  = useRef(0);   // AudioContext.currentTime（播放开始时刻）
  const offsetRef     = useRef(0);   // seek 偏移（秒）
  const rafRef        = useRef<number>(0);

  // ── 清理 ────────────────────────────────────────────────────────────────────
  const stopSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try { sourceRef.current.stop(); } catch (_) {}
      sourceRef.current.disconnect();
      sourceRef.current = null;
    }
  }, []);

  const stopRaf = useCallback(() => {
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = 0;
    }
  }, []);

  // ── 每帧更新播放位置 ────────────────────────────────────────────────────────
  const tick = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !isPlayingRef.current) return;

    const elapsed = ctx.currentTime - startTimeRef.current;
    const pos = Math.min(offsetRef.current + elapsed, duration);
    setCurrentTime(pos);

    rafRef.current = requestAnimationFrame(tick);
  }, [duration]);

  // ── 加载音频 ────────────────────────────────────────────────────────────────
  const loadFile = useCallback(async (path: string) => {
    // 停止旧播放
    stopSource();
    stopRaf();
    isPlayingRef.current = false;
    offsetRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setPlayState("loading");

    try {
      // 懒创建 AudioContext（必须在用户手势之后，或在这里首次创建）
      if (!ctxRef.current || ctxRef.current.state === "closed") {
        ctxRef.current = new AudioContext();
      }
      const ctx = ctxRef.current;

      // convertFileSrc 把本地路径转为 WebView 可访问的 asset URL
      const url = convertFileSrc(path);
      const response = await fetch(url);
      if (!response.ok) throw new Error(`fetch failed: ${response.status}`);

      const arrayBuffer = await response.arrayBuffer();
      const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

      bufferRef.current = audioBuffer;
      setDuration(audioBuffer.duration);
      setPlayState("ready");
    } catch (err) {
      console.error("Audio load failed:", err);
      setPlayState("idle");
    }
  }, [stopSource, stopRaf]);

  // ── 播放 ────────────────────────────────────────────────────────────────────
  const play = useCallback((fromSec?: number) => {
    const ctx    = ctxRef.current;
    const buffer = bufferRef.current;
    if (!ctx || !buffer) return;

    // 如果指定了起始位置，先 seek
    if (fromSec !== undefined) {
      offsetRef.current = Math.max(0, Math.min(fromSec, buffer.duration));
    }

    // 恢复已挂起的 AudioContext（某些浏览器策略）
    if (ctx.state === "suspended") ctx.resume();

    stopSource();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    // 播放结束时自动回到 ready 状态
    source.onended = () => {
      if (!isPlayingRef.current) return; // 主动 stop 不触发
      isPlayingRef.current = false;
      stopRaf();
      setCurrentTime(buffer.duration);
      setPlayState("ready");
    };

    source.start(0, offsetRef.current);
    sourceRef.current   = source;
    startTimeRef.current = ctx.currentTime;
    isPlayingRef.current = true;

    setPlayState("playing");
    rafRef.current = requestAnimationFrame(tick);
  }, [stopSource, stopRaf, tick]);

  // ── 暂停 ────────────────────────────────────────────────────────────────────
  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    const ctx = ctxRef.current;
    if (!ctx) return;

    // 记录暂停位置作为下次播放的 offset
    const elapsed = ctx.currentTime - startTimeRef.current;
    offsetRef.current = Math.min(offsetRef.current + elapsed, duration);

    isPlayingRef.current = false;
    stopSource();
    stopRaf();
    setCurrentTime(offsetRef.current);
    setPlayState("paused");
  }, [stopSource, stopRaf, duration]);

  // ── 定位 ────────────────────────────────────────────────────────────────────
  const seek = useCallback((sec: number) => {
    const buffer = bufferRef.current;
    if (!buffer) return;

    const clamped = Math.max(0, Math.min(sec, buffer.duration));
    offsetRef.current = clamped;
    setCurrentTime(clamped);

    // 正在播放时立即从新位置继续
    if (isPlayingRef.current) {
      play(clamped);
    }
  }, [play]);

  // ── 播放/暂停切换 ────────────────────────────────────────────────────────────
  const toggle = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [play, pause]);

  // ── 卸载 ────────────────────────────────────────────────────────────────────
  const unload = useCallback(() => {
    stopSource();
    stopRaf();
    isPlayingRef.current = false;
    bufferRef.current = null;
    offsetRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setPlayState("idle");
  }, [stopSource, stopRaf]);

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopSource();
      stopRaf();
      ctxRef.current?.close();
    };
  }, [stopSource, stopRaf]);

  return {
    playState,
    currentTime,
    duration,
    loadFile,
    play,
    pause,
    seek,
    toggle,
    unload,
  };
}