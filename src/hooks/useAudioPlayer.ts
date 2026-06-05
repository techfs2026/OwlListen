import { useState, useCallback, useRef, useEffect } from "react";
import { convertFileSrc } from "@tauri-apps/api/core";

export type PlayState = "idle" | "loading" | "ready" | "playing" | "paused";

interface UseAudioPlayerReturn {
  playState: PlayState;
  currentTime: number;
  duration: number;
  loopRange: [number, number] | null;
  load: (urlOrPath: string) => Promise<void>;
  prefetch: (urlOrPath: string) => Promise<void>;
  play: (fromSec?: number) => void;
  /** 播放 [start, end] 区间，到 end 自动停止，不受 loopRange 影响 */
  playSegment: (start: number, end: number) => void;
  pause: () => void;
  seek: (sec: number) => void;
  toggle: () => void;
  unload: () => void;
  setLoop: (range: [number, number] | null) => void;
}

function toFetchUrl(urlOrPath: string): string {
  return /^(blob:|https?:)/.test(urlOrPath) ? urlOrPath : convertFileSrc(urlOrPath);
}

const bufferCache = new Map<string, AudioBuffer>();

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
  const [loopRange, setLoopRange] = useState<[number, number] | null>(null);

  const bufferRef = useRef<AudioBuffer | null>(null);
  const sourceRef = useRef<AudioBufferSourceNode | null>(null);

  const isPlayingRef = useRef(false);
  const startTimeRef = useRef(0);
  const offsetRef = useRef(0);
  const durationRef = useRef(0);
  const rafRef = useRef<number>(0);
  const loopRangeRef = useRef<[number, number] | null>(null);

  const currentLoadId = useRef(0);

  const getCtx = useCallback(() => getGlobalCtx(), []);

  const stopSource = useCallback(() => {
    if (sourceRef.current) {
      sourceRef.current.onended = null;
      try {
        sourceRef.current.stop();
      } catch (_) {}
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

  // keep loopRangeRef in sync
  const setLoop = useCallback((range: [number, number] | null) => {
    loopRangeRef.current = range;
    setLoopRange(range);
  }, []);

  const tick = useCallback(() => {
    const ctx = getGlobalCtx();
    if (!ctx || !isPlayingRef.current) return;

    const rawLatency = ctx.outputLatency;
    const latency = Number.isFinite(rawLatency) ? rawLatency : 0;
    const elapsed = ctx.currentTime - startTimeRef.current - latency;
    const pos = Math.min(offsetRef.current + Math.max(0, elapsed), durationRef.current);
    setCurrentTime(pos);

    // Loop boundary check: if we've passed the loop end, restart the loop
    const lr = loopRangeRef.current;
    if (lr && pos >= lr[1] - latency) {
      // restart from loop start — play() will re-schedule the source
      offsetRef.current = lr[0];
      isPlayingRef.current = false; // temporarily so play() doesn't double-start
      stopSource();
      stopRaf();

      const buffer = bufferRef.current;
      if (!buffer) return;

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      source.onended = () => {
        // only fire if we're NOT in a loop (loop restarts above handle it)
        if (!loopRangeRef.current) {
          stopRaf();
          setCurrentTime(buffer.duration);
          offsetRef.current = 0;
          isPlayingRef.current = false;
          setPlayState("ready");
        }
      };

      source.start(0, lr[0]);
      sourceRef.current = source;
      startTimeRef.current = ctx.currentTime;
      isPlayingRef.current = true;
      rafRef.current = requestAnimationFrame(tick);
      return;
    }

    rafRef.current = requestAnimationFrame(tick);
  }, [stopSource, stopRaf]);

  const fetchAndDecode = useCallback(
    async (urlOrPath: string): Promise<AudioBuffer> => {
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
    },
    [getCtx],
  );

  const prefetch = useCallback(
    async (urlOrPath: string): Promise<void> => {
      try {
        await fetchAndDecode(urlOrPath);
      } catch (err) {
        console.warn("[useAudioPlayer] prefetch failed:", urlOrPath, err);
      }
    },
    [fetchAndDecode],
  );

  const load = useCallback(
    async (urlOrPath: string): Promise<void> => {
      const loadId = ++currentLoadId.current;

      stopSource();
      stopRaf();
      isPlayingRef.current = false;
      bufferRef.current = null;
      offsetRef.current = 0;
      setCurrentTime(0);
      setDuration(0);
      durationRef.current = 0;
      setPlayState("loading");

      try {
        const audioBuffer = await fetchAndDecode(urlOrPath);
        if (loadId !== currentLoadId.current) return;

        bufferRef.current = audioBuffer;
        durationRef.current = audioBuffer.duration;
        setDuration(audioBuffer.duration);
        setPlayState("ready");
      } catch (err) {
        if (loadId !== currentLoadId.current) return;
        console.error("[useAudioPlayer] load failed:", err);
        setPlayState("idle");
      }
    },
    [stopSource, stopRaf, fetchAndDecode],
  );

  const play = useCallback(
    (fromSec?: number) => {
      const ctx = getCtx();
      const buffer = bufferRef.current;
      if (!buffer) return;

      if (fromSec !== undefined) {
        offsetRef.current = Math.max(0, Math.min(fromSec, buffer.duration));
      }

      if (ctx.state === "suspended") {
        ctx.resume().catch(console.warn);
      }

      stopSource();

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      source.onended = () => {
        if (!loopRangeRef.current) {
          stopRaf();
          setCurrentTime(buffer.duration);
          offsetRef.current = 0;
          isPlayingRef.current = false;
          setPlayState("ready");
        }
      };

      source.start(0, offsetRef.current);
      sourceRef.current = source;
      startTimeRef.current = ctx.currentTime;
      isPlayingRef.current = true;

      setPlayState("playing");
      rafRef.current = requestAnimationFrame(tick);
    },
    [getCtx, stopSource, stopRaf, tick],
  );

  // 播放一个精确区间 [start, end]，到 end 自动停止，忽略 loopRange
  const playSegment = useCallback(
    (start: number, end: number) => {
      const ctx = getCtx();
      const buffer = bufferRef.current;
      if (!buffer || end <= start) return;

      const clampedStart = Math.max(0, Math.min(start, buffer.duration));
      const clampedEnd = Math.max(0, Math.min(end, buffer.duration));
      const segDur = clampedEnd - clampedStart;

      if (ctx.state === "suspended") ctx.resume().catch(console.warn);

      stopSource();
      stopRaf();

      offsetRef.current = clampedStart;
      setCurrentTime(clampedStart);

      const source = ctx.createBufferSource();
      source.buffer = buffer;
      source.connect(ctx.destination);

      source.onended = () => {
        stopRaf();
        setCurrentTime(clampedEnd);
        offsetRef.current = clampedEnd;
        isPlayingRef.current = false;
        setPlayState("ready");
      };

      // 精确在 segDur 秒后停止
      source.start(0, clampedStart, segDur);
      sourceRef.current = source;
      startTimeRef.current = ctx.currentTime;
      isPlayingRef.current = true;

      setPlayState("playing");
      rafRef.current = requestAnimationFrame(tick);
    },
    [getCtx, stopSource, stopRaf, tick],
  );

  const pause = useCallback(() => {
    if (!isPlayingRef.current) return;
    const ctx = getGlobalCtx();

    const rawLatency = ctx.outputLatency;
    const latency = Number.isFinite(rawLatency) ? rawLatency : 0;
    const elapsed = ctx.currentTime - startTimeRef.current - latency;
    offsetRef.current = Math.min(offsetRef.current + Math.max(0, elapsed), durationRef.current);

    isPlayingRef.current = false;
    stopSource();
    stopRaf();
    setCurrentTime(offsetRef.current);
    setPlayState("paused");
  }, [stopSource, stopRaf]);

  const seek = useCallback(
    (sec: number) => {
      const buffer = bufferRef.current;
      if (!buffer) return;

      const clamped = Math.max(0, Math.min(sec, buffer.duration));
      offsetRef.current = clamped;
      setCurrentTime(clamped);

      if (isPlayingRef.current) {
        play(clamped);
      }
    },
    [play],
  );

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
    loopRangeRef.current = null;
    setCurrentTime(0);
    setDuration(0);
    setLoopRange(null);
    setPlayState("idle");
  }, [stopSource, stopRaf]);

  useEffect(() => {
    return () => {
      stopSource();
      stopRaf();
    };
  }, [stopSource, stopRaf]);

  return {
    playState,
    currentTime,
    duration,
    loopRange,
    load,
    prefetch,
    play,
    playSegment,
    pause,
    seek,
    toggle,
    unload,
    setLoop,
  };
}
