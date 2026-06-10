// usePracticePlayer —— 与 useAudioPlayer 接口一致的精听播放器 hook，
// 底层走 Rust 内存 buffer 引擎（src-tauri/src/practice + practiceApi）。
// 相比 useAudioPlayer 多出 speed / setSpeed（变速不变调）。
//
// 位置 currentTime 来自 Rust "practice-progress" 事件（源秒），与波形（按源时间绘制）一致。
import { useState, useCallback, useEffect, useRef } from "react";
import {
  practiceOpen,
  practicePlay,
  practicePause,
  practiceSeek,
  practicePlaySegment,
  practiceSetLoop,
  practiceSetSpeed,
  practiceClose,
  onPracticeProgress,
  onPracticeEnded,
} from "@/utils/practiceApi";
import type { UnlistenFn } from "@tauri-apps/api/event";

export type PlayState = "idle" | "loading" | "ready" | "playing" | "paused";

export interface UsePracticePlayerReturn {
  playState: PlayState;
  currentTime: number;
  /**
   * currentTime 对应的「墙钟时刻」（performance.now 域，毫秒）。
   * 进度事件经时钟对齐扣除传输延迟后得到，比 performance.now() 略早；
   * 供波形播放头按它为锚点外推，消除事件传输滞后。手动 seek 时取当下。
   */
  playheadWallMs: number;
  duration: number;
  loopRange: [number, number] | null;
  speed: number;
  load: (path: string) => Promise<void>;
  prefetch: (path: string) => Promise<void>;
  play: (fromSec?: number) => void;
  playSegment: (start: number, end: number) => void;
  pause: () => void;
  seek: (sec: number) => void;
  toggle: () => void;
  unload: () => void;
  setLoop: (range: [number, number] | null) => void;
  setSpeed: (speed: number) => void;
}

export function usePracticePlayer(): UsePracticePlayerReturn {
  const [playState, setPlayStateRaw] = useState<PlayState>("idle");
  const [currentTime, setCurrentTime] = useState(0);
  const [playheadWallMs, setPlayheadWallMs] = useState(0);
  const [duration, setDuration] = useState(0);
  const [loopRange, setLoopRange] = useState<[number, number] | null>(null);
  const [speed, setSpeedState] = useState(1);

  // 两边单调时钟的最小偏移（performance.now − emitMs 的最小值）。
  // 最小值即「基准偏移 + 最小传输延迟」，据此可还原每条事件的真实发出墙钟时刻。
  // 每次 open 重置（Rust 端时钟基准随会话重建）。
  const minSkewRef = useRef<number | null>(null);

  const playStateRef = useRef<PlayState>("idle");
  const setPlayState = useCallback((s: PlayState) => {
    playStateRef.current = s;
    setPlayStateRaw(s);
  }, []);

  // Rust 事件订阅：进度 + 播完
  useEffect(() => {
    let active = true;
    const unsubs: UnlistenFn[] = [];
    (async () => {
      const u1 = await onPracticeProgress((p) => {
        // 时钟对齐：skew = 收到时刻 − 发出时刻；取历史最小值估出基准偏移，
        // 还原本条事件「发出」对应的 performance.now 墙钟（≤ 当下），扣掉传输延迟。
        const perfNow = performance.now();
        const skew = perfNow - p.emitMs;
        if (minSkewRef.current === null || skew < minSkewRef.current) {
          minSkewRef.current = skew;
        }
        setCurrentTime(p.positionSec);
        setPlayheadWallMs(p.emitMs + minSkewRef.current);
      });
      const u2 = await onPracticeEnded(() => {
        // 播完：停掉静音输出，回到 ready
        practicePause().catch(() => {});
        if (playStateRef.current === "playing") setPlayState("ready");
      });
      if (!active) {
        u1();
        u2();
        return;
      }
      unsubs.push(u1, u2);
    })();
    return () => {
      active = false;
      unsubs.forEach((u) => u());
    };
  }, [setPlayState]);

  const load = useCallback(
    async (path: string) => {
      setPlayState("loading");
      setCurrentTime(0);
      setPlayheadWallMs(0);
      minSkewRef.current = null; // 新会话，Rust 时钟基准重建，重新对齐
      setLoopRange(null);
      setSpeedState(1);
      try {
        const dur = await practiceOpen(path);
        setDuration(dur);
        setPlayState("ready");
      } catch (err) {
        console.error("[usePracticePlayer] load failed:", err);
        setPlayState("idle");
      }
    },
    [setPlayState],
  );

  const play = useCallback(
    (fromSec?: number) => {
      setPlayState("playing"); // 乐观置位，UI 立即响应
      (async () => {
        if (fromSec !== undefined) await practiceSeek(fromSec);
        await practicePlay();
      })().catch((e) => console.warn("[usePracticePlayer] play:", e));
    },
    [setPlayState],
  );

  const playSegment = useCallback(
    (start: number, end: number) => {
      setPlayState("playing");
      practicePlaySegment(start, end).catch((e) =>
        console.warn("[usePracticePlayer] playSegment:", e),
      );
    },
    [setPlayState],
  );

  const pause = useCallback(() => {
    setPlayState("paused");
    practicePause().catch((e) => console.warn("[usePracticePlayer] pause:", e));
  }, [setPlayState]);

  const seek = useCallback((sec: number) => {
    setCurrentTime(sec); // 立即反馈；Rust 端暂停态也已直接更新 pos
    setPlayheadWallMs(performance.now()); // 手动 seek 是「当下」的位置，无传输延迟
    practiceSeek(sec).catch((e) => console.warn("[usePracticePlayer] seek:", e));
  }, []);

  const toggle = useCallback(() => {
    if (playStateRef.current === "playing") pause();
    else play();
  }, [play, pause]);

  const unload = useCallback(() => {
    practiceClose().catch(() => {});
    setPlayState("idle");
    setCurrentTime(0);
    setPlayheadWallMs(0);
    minSkewRef.current = null;
    setDuration(0);
    setLoopRange(null);
    setSpeedState(1);
  }, [setPlayState]);

  const setLoop = useCallback((range: [number, number] | null) => {
    setLoopRange(range);
    practiceSetLoop(range).catch((e) => console.warn("[usePracticePlayer] setLoop:", e));
  }, []);

  const setSpeed = useCallback((sp: number) => {
    setSpeedState(sp);
    practiceSetSpeed(sp).catch((e) => console.warn("[usePracticePlayer] setSpeed:", e));
  }, []);

  const prefetch = useCallback(async (_path: string) => {
    // buffer 引擎无需预取；保留以兼容 useAudioPlayer 接口
  }, []);

  return {
    playState,
    currentTime,
    playheadWallMs,
    duration,
    loopRange,
    speed,
    load,
    prefetch,
    play,
    playSegment,
    pause,
    seek,
    toggle,
    unload,
    setLoop,
    setSpeed,
  };
}
