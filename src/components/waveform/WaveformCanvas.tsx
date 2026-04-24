import { useEffect, useRef, useCallback, useState } from "react";
import { useWebGL } from "@/hooks/useWebGL";
import type { Label, ViewRange, WaveformColors } from "@/types/waveform";
import { DEFAULT_COLORS } from "@/types/waveform";

interface WaveformCanvasProps {
  peaks: Float32Array | null;
  viewRange: ViewRange;
  duration: number;
  playhead: number;
  labels: Label[];
  labelingMode: boolean;
  colors?: Partial<WaveformColors>;
  onSeek: (sec: number) => void;
  onRegionSelected: (start: number, end: number) => void;
  onZoom: (delta: number, centerSec: number) => void;
  onScroll: (deltaSec: number) => void;
}

export function WaveformCanvas({
  peaks,
  viewRange,
  duration,
  playhead,
  labels,
  labelingMode,
  colors: colorOverrides,
  onSeek,
  onRegionSelected,
  onZoom,
  onScroll,
}: WaveformCanvasProps) {
  const { canvasRef, render } = useWebGL();
  const colors = { ...DEFAULT_COLORS, ...colorOverrides };

  // 拖拽状态（纯 ref，不触发 re-render）
  const dragRef = useRef<{ startSec: number; currentSec: number } | null>(null);
  const [dragDisplay, setDragDisplay] = useState<[number, number] | null>(null);

  // ── 坐标转换 ────────────────────────────────────────────────────────────────
  const xToSec = useCallback(
    (x: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const ratio = (x - rect.left) / rect.width;
      return (
        viewRange.startSec +
        ratio * (viewRange.endSec - viewRange.startSec)
      );
    },
    [canvasRef, viewRange]
  );

  const secToRatio = useCallback(
    (sec: number): number => {
      const dur = viewRange.endSec - viewRange.startSec;
      if (dur <= 0) return 0;
      return (sec - viewRange.startSec) / dur;
    },
    [viewRange]
  );

  // ── 鼠标事件 ────────────────────────────────────────────────────────────────
  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;
      const sec = xToSec(e.clientX);

      if (labelingMode) {
        dragRef.current = { startSec: sec, currentSec: sec };
        setDragDisplay([secToRatio(sec), secToRatio(sec)]);
      } else {
        onSeek(sec);
      }
    },
    [labelingMode, xToSec, secToRatio, onSeek]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current) return;
      const sec = xToSec(e.clientX);
      dragRef.current.currentSec = sec;

      const s = Math.min(dragRef.current.startSec, sec);
      const en = Math.max(dragRef.current.startSec, sec);
      setDragDisplay([secToRatio(s), secToRatio(en)]);
    },
    [xToSec, secToRatio]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current) return;
      const sec = xToSec(e.clientX);
      const start = Math.min(dragRef.current.startSec, sec);
      const end   = Math.max(dragRef.current.startSec, sec);

      if (end - start >= 0.05) {
        onRegionSelected(start, end);
      }
      dragRef.current = null;
      setDragDisplay(null);
    },
    [xToSec, onRegionSelected]
  );

  const handleMouseLeave = useCallback(() => {
    if (dragRef.current) {
      dragRef.current = null;
      setDragDisplay(null);
    }
  }, []);

  const handleWheel = useCallback(
    (e: React.WheelEvent) => {
      e.preventDefault();
      const centerSec = xToSec(e.clientX);

      if (e.ctrlKey || e.metaKey) {
        // Ctrl+滚轮：缩放
        onZoom(e.deltaY, centerSec);
      } else {
        // 普通滚轮：横向滚动
        const dur = viewRange.endSec - viewRange.startSec;
        const deltaSec = (e.deltaY / 200) * dur;
        onScroll(deltaSec);
      }
    },
    [xToSec, viewRange, onZoom, onScroll]
  );

  // ── 渲染 ────────────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!peaks) return;

    const playheadRatio = duration > 0 ? secToRatio(playhead) : 0;

    // 把 labels 转为当前视图内的 0~1 范围
    const normalizedLabels = labels.map((l) => ({
      start: secToRatio(l.start),
      end:   secToRatio(l.end),
    }));

    render({
      peaks,
      playhead: playheadRatio,
      dragRange: dragDisplay,
      labels: normalizedLabels,
      colors,
    });
  }, [peaks, playhead, duration, labels, dragDisplay, colors, render, secToRatio]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        cursor: labelingMode ? "crosshair" : "pointer",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    />
  );
}
