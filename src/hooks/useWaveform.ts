import { useState, useCallback, useRef } from "react";
import { loadAudio, getPeaks } from "@/utils/tauriApi";
import type { AudioInfo, ViewRange, LoadingState, RenderData } from "@/types/waveform";

interface UseWaveformReturn {
  audioInfo: AudioInfo | null;
  loadingState: LoadingState;
  errorMessage: string;
  viewRange: ViewRange;
  // 加载音频文件
  loadFile: (path: string) => Promise<void>;
  // 获取当前视图的渲染数据(调用 Rust)
  fetchPeaks: (pixelWidth: number) => Promise<RenderData | null>;
  // 视图控制
  setViewRange: (range: ViewRange) => void;
  zoomIn: (centerSec?: number) => void;
  zoomOut: (centerSec?: number) => void;
  zoomReset: () => void;
  scrollBy: (deltaSec: number) => void;
}

const MIN_VISIBLE_SECS = 0.001;  // 允许深度放大到 1ms 视图,触发 Polyline/Stem 模式

export function useWaveform(): UseWaveformReturn {
  const [audioInfo, setAudioInfo] = useState<AudioInfo | null>(null);
  const [loadingState, setLoadingState] = useState<LoadingState>("idle");
  const [errorMessage, setErrorMessage] = useState("");
  const [viewRange, setViewRangeState] = useState<ViewRange>({
    startSec: 0,
    endSec: 30,
  });

  const audioInfoRef = useRef<AudioInfo | null>(null);

  const loadFile = useCallback(async (path: string) => {
    setLoadingState("decoding");
    setErrorMessage("");
    setAudioInfo(null);

    try {
      const info = await loadAudio(path);
      audioInfoRef.current = info;
      setAudioInfo(info);
      setViewRangeState({ startSec: 0, endSec: info.duration });
      setLoadingState("ready");
    } catch (err) {
      setErrorMessage(String(err));
      setLoadingState("error");
    }
  }, []);

  const reqIdRef = useRef(0);

  const fetchPeaks = useCallback(async (pixelWidth: number) => {
    const myId = ++reqIdRef.current;
    const data = await getPeaks(viewRange.startSec, viewRange.endSec, pixelWidth);
    if (myId !== reqIdRef.current) return null;  // 已被新请求覆盖
    return data;
  }, [viewRange]);

  const setViewRange = useCallback(
    (range: ViewRange) => {
      const duration = audioInfoRef.current?.duration ?? Infinity;
      const dur = Math.max(range.endSec - range.startSec, MIN_VISIBLE_SECS);
      const start = Math.max(0, Math.min(range.startSec, duration - dur));
      const end = Math.min(start + dur, duration);
      setViewRangeState({ startSec: start, endSec: end });
    },
    []
  );

  const zoomIn = useCallback(
    (centerSec?: number) => {
      setViewRangeState((prev) => {
        const dur = prev.endSec - prev.startSec;
        if (dur <= MIN_VISIBLE_SECS) return prev;
        const center = centerSec ?? prev.startSec + dur * 0.5;
        const newDur = Math.max(dur * 0.6, MIN_VISIBLE_SECS);
        const start = Math.max(0, center - newDur * 0.5);
        const end = start + newDur;
        const duration = audioInfoRef.current?.duration ?? Infinity;
        return {
          startSec: Math.min(start, duration - newDur),
          endSec: Math.min(end, duration),
        };
      });
    },
    []
  );

  const zoomOut = useCallback(
    (centerSec?: number) => {
      setViewRangeState((prev) => {
        const dur = prev.endSec - prev.startSec;
        const duration = audioInfoRef.current?.duration ?? Infinity;
        if (dur >= duration) return prev;
        const center = centerSec ?? prev.startSec + dur * 0.5;
        const newDur = Math.min(dur / 0.6, duration);
        const start = Math.max(0, center - newDur * 0.5);
        const end = Math.min(start + newDur, duration);
        return { startSec: start, endSec: end };
      });
    },
    []
  );

  const zoomReset = useCallback(() => {
    const duration = audioInfoRef.current?.duration;
    if (duration) {
      setViewRangeState({ startSec: 0, endSec: duration });
    }
  }, []);

  const scrollBy = useCallback((deltaSec: number) => {
    setViewRangeState((prev) => {
      const dur = prev.endSec - prev.startSec;
      const duration = audioInfoRef.current?.duration ?? Infinity;
      const start = Math.max(0, Math.min(prev.startSec + deltaSec, duration - dur));
      return { startSec: start, endSec: start + dur };
    });
  }, []);

  return {
    audioInfo,
    loadingState,
    errorMessage,
    viewRange,
    loadFile,
    fetchPeaks,
    setViewRange,
    zoomIn,
    zoomOut,
    zoomReset,
    scrollBy,
  };
}