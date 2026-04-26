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

// ── 全局缓存与全局 AudioContext（跨模块共享）──────────────────────────────────
// key: 原始 urlOrPath，value: 解码完成的 AudioBuffer
const bufferCache = new Map<string, AudioBuffer>();

// 将 AudioContext 改为全局单例，避免触碰浏览器 6 个 Context 的上限
let globalAudioContext: AudioContext | null = null;
function getGlobalCtx(): AudioContext {
  if (!globalAudioContext || globalAudioContext.state === "closed") {
    globalAudioContext = new AudioContext();
  }
  return globalAudioContext;
}

export function useAudioPlayer(): UseAudioPlayerReturn {
  const [playState, setPlayState] = useState<PlayState>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);

  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const isPlayingRef = useRef(false);
  const startTimeRef = useRef(0);
  const offsetRef = useRef(0);
  const durationRef = useRef(0);
  const rafRef = useRef<number>(0);
  
  // 增加 loadId 防抖，防止连续切换片段引发的数据竞态
  const currentLoadId = useRef(0);

  const getCtx = useCallback(() => getGlobalCtx(), []);

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

  const tick = useCallback(() => {
    const ctx = getGlobalCtx();
    if (!ctx || !isPlayingRef.current) return;

    const elapsed = ctx.currentTime - startTimeRef.current;
    const pos = Math.min(offsetRef.current + elapsed, durationRef.current);
    setCurrentTime(pos);

    rafRef.current = requestAnimationFrame(tick);
  }, []);

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

  const prefetch = useCallback(async (urlOrPath: string): Promise<void> => {
    try { 
      await fetchAndDecode(urlOrPath); 
    } catch (err) { 
      console.warn("[useAudioPlayer] prefetch failed:", urlOrPath, err); 
    }
  }, [fetchAndDecode]);

  const load = useCallback(async (urlOrPath: string): Promise<void> => {
    const loadId = ++currentLoadId.current;

    stopSource();
    stopRaf();
    isPlayingRef.current = false;
    bufferRef.current = null; // 开始加载时清空旧 buffer，防止快捷键误播上一首
    offsetRef.current = 0;
    setCurrentTime(0);
    setDuration(0);
    durationRef.current = 0;
    setPlayState("loading");

    try {
      const audioBuffer = await fetchAndDecode(urlOrPath);
      if (loadId !== currentLoadId.current) return; // 如果发起了新加载，丢弃旧的响应

      bufferRef.current = audioBuffer;
      durationRef.current = audioBuffer.duration;
      setDuration(audioBuffer.duration);
      setPlayState("ready");
    } catch (err) {
      if (loadId !== currentLoadId.current) return;
      console.error("[useAudioPlayer] load failed:", err);
      setPlayState("idle");
    }
  }, [stopSource, stopRaf, fetchAndDecode]);

  const play = useCallback((fromSec?: number) => {
    const ctx = getCtx();
    const buffer = bufferRef.current;
    if (!buffer) return; // loading 时 buffer 为 null，直接拦截非法触发
  
    if (fromSec !== undefined) {
      offsetRef.current = Math.max(0, Math.min(fromSec, buffer.duration));
    }
  
    // 同步触发 resume，不阻塞后续 start 的调度
    if (ctx.state === "suspended") {
      ctx.resume().catch(console.warn); 
    }
  
    stopSource();
  
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(ctx.destination);
  
    source.onended = () => {
      stopRaf();
      setCurrentTime(buffer.duration);
      offsetRef.current = 0;
      isPlayingRef.current = false;
      setPlayState("ready");
    };
  
    source.start(0, offsetRef.current);
  
    sourceRef.current = source;
    startTimeRef.current = ctx.currentTime;
    isPlayingRef.current = true;
  
    setPlayState("playing");
    rafRef.current = requestAnimationFrame(tick);
  }, [getCtx, stopSource, stopRaf, tick]);

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    const ctx = getGlobalCtx();

    const elapsed = ctx.currentTime - startTimeRef.current;
    offsetRef.current = Math.min(offsetRef.current + elapsed, durationRef.current);

    isPlayingRef.current = false;
    stopSource();
    stopRaf();
    setCurrentTime(offsetRef.current);
    setPlayState("paused");
  }, [stopSource, stopRaf]);

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

  const toggle = useCallback(() => {
    if (isPlayingRef.current) pause();
    else play();
  }, [play, pause]);

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

  // 组件卸载时清理
  useEffect(() => {
    return () => {
      stopSource();
      stopRaf();
      // 不再调用 close() 销毁 Context，交由全局单例管理
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