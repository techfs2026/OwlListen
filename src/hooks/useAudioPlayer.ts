import { useState, useCallback, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

export type PlayState = "idle" | "loading" | "ready" | "playing" | "paused";

interface UseAudioPlayerReturn {
  playState: PlayState;
  currentTime: number;       // 当前播放位置（秒）
  duration: number;          // 音频总时长（秒）
  load: (urlOrPath: string) => Promise<void>;   // 统一入口：blob URL / http URL / 本地路径均可
  prefetch: (urlOrPath: string) => Promise<void>; // 预加载但不切换当前播放
  play: (fromSec?: number) => void;
  pause: () => void;
  seek: (sec: number) => void;
  toggle: () => void;
  unload: () => void;
}

// ── 内部工具：路径 → 可 fetch 的 URL ─────────────────────────────────────────
function toFetchUrl(urlOrPath: string): string {
  return /^(blob:|https?:)/.test(urlOrPath)
    ? urlOrPath
    : convertFileSrc(urlOrPath);
}

// ── 预加载缓存（模块级，跨 hook 实例共享）────────────────────────────────────
// key: 原始 urlOrPath，value: 解码完成的 AudioBuffer
const bufferCache = new Map<string, AudioBuffer>();

export function useAudioPlayer(): UseAudioPlayerReturn {
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  // Web Audio API 核心对象
  const ctxRef = useRef<AudioContext | null>(null);
  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  // 播放状态追踪（ref 避免 RAF 回调里读到过时的 state）
  const isPlayingRef = useRef(false);
  const startTimeRef = useRef(0);    // AudioContext.currentTime（播放开始时刻）
  const offsetRef = useRef(0);    // 当前播放偏移（秒）
  const durationRef = useRef(0);    // duration 的 ref 版，供 tick 读取避免闭包问题
  const rafRef = useRef<number>(0);

  // ── 懒创建 AudioContext ──────────────────────────────────────────────────────
  const getCtx = useCallback((): AudioContext => {
    if (!ctxRef.current || ctxRef.current.state === "closed") {
      ctxRef.current = new AudioContext();
    }
    return ctxRef.current;
  }, []);

  // ── 清理 ────────────────────────────────────────────────────────────────────
  const stopSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try { sourceRef.current.stop(); } catch (_) { }
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

  // ── 每帧更新播放位置（用 ref 读 duration，避免闭包陈旧值）──────────────────
  const tick = useCallback(() => {
    const ctx = ctxRef.current;
    if (!ctx || !isPlayingRef.current) return;

    const elapsed = ctx.currentTime - startTimeRef.current;
    const pos = Math.min(offsetRef.current + elapsed, durationRef.current);
    setCurrentTime(pos);

    rafRef.current = requestAnimationFrame(tick);
  }, []); // 无外部依赖，稳定引用

  // ── 内部：fetch + decode，优先读缓存 ─────────────────────────────────────────
  const fetchAndDecode = useCallback(async (urlOrPath: string): Promise<AudioBuffer> => {
    if (bufferCache.has(urlOrPath)) {
      return bufferCache.get(urlOrPath)!;
    }
    const ctx = getCtx();
    const url = toFetchUrl(urlOrPath);
    const response = await fetch(url);
    if (!response.ok) throw new Error(`fetch failed: ${response.status}`);
    const arrayBuffer = await response.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);
    bufferCache.set(urlOrPath, audioBuffer);
    return audioBuffer;
  }, [getCtx]);

  // ── 预加载（不切换当前播放）────────────────────────────────────────────────
  const prefetch = useCallback(async (urlOrPath: string): Promise<void> => {
    try {
      await fetchAndDecode(urlOrPath);
    } catch (err) {
      console.warn("[useAudioPlayer] prefetch failed:", urlOrPath, err);
    }
  }, [fetchAndDecode]);

  // ── 加载并切换到新音频 ───────────────────────────────────────────────────────
  const load = useCallback(async (urlOrPath: string): Promise<void> => {
    stopSource();
    stopRaf();
    isPlayingRef.current = false;
    offsetRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    setPlayState("loading");

    try {
      const audioBuffer = await fetchAndDecode(urlOrPath);
      bufferRef.current = audioBuffer;
      durationRef.current = audioBuffer.duration;
      setDuration(audioBuffer.duration);
      setPlayState("ready");
    } catch (err) {
      console.error("[useAudioPlayer] load failed:", err);
      setPlayState("idle");
    }
  }, [stopSource, stopRaf, fetchAndDecode]);

  // 兼容旧接口 loadFile
  const loadFile = load;

  // ── 播放 ────────────────────────────────────────────────────────────────────
  const play = useCallback((fromSec?: number) => {
    const ctx = getCtx();
    const buffer = bufferRef.current;
    if (!buffer) return;

    if (fromSec !== undefined) {
      offsetRef.current = Math.max(0, Math.min(fromSec, buffer.duration));
    }

    if (ctx.state === "suspended") ctx.resume();

    stopSource();

    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);

    source.onended = () => {
      if (!isPlayingRef.current) return; // 主动 stop 不触发
      isPlayingRef.current = false;
      stopRaf();
      setCurrentTime(buffer.duration);
      offsetRef.current = 0; // 播完复位，下次从头播
      setPlayState("ready");
    };

    source.start(0, offsetRef.current);
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime;
    isPlayingRef.current = true;

    setPlayState("playing");
    rafRef.current = requestAnimationFrame(tick);
  }, [getCtx, stopSource, stopRaf, tick]);

  // ── 暂停 ────────────────────────────────────────────────────────────────────
  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    const ctx = ctxRef.current;
    if (!ctx) return;

    const elapsed = ctx.currentTime - startTimeRef.current;
    offsetRef.current = Math.min(offsetRef.current + elapsed, durationRef.current);

    isPlayingRef.current = false;
    stopSource();
    stopRaf();
    setCurrentTime(offsetRef.current);
    setPlayState("paused");
  }, [stopSource, stopRaf]);

  // ── 定位 ────────────────────────────────────────────────────────────────────
  const seek = useCallback((sec: number) => {
    const buffer = bufferRef.current;
    if (!buffer) return;

    const clamped = Math.max(0, Math.min(sec, buffer.duration));
    offsetRef.current = clamped;
    setCurrentTime(clamped);

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
    durationRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    setPlayState("idle");
  }, [stopSource, stopRaf]);

  // 组件卸载时清理（不清缓存，缓存是模块级的）
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
    load,
    prefetch,
    play,
    pause,
    seek,
    toggle,
    unload,
  };
}