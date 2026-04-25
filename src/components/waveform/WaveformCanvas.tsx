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
  colors?: Partial<WaveformColors>;
  onSeek: (sec: number) => void;
  onRegionSelected: (start: number, end: number) => void;
  onZoom: (delta: number, centerSec: number) => void;
  onScroll: (deltaSec: number) => void;
}

const DRAG_THRESHOLD_PX = 6; // 超过这个像素才认为是拖拽标记

export function WaveformCanvas({
  peaks,
  viewRange,
  duration,
  playhead,
  labels,
  colors: colorOverrides,
  onSeek,
  onRegionSelected,
  onZoom,
  onScroll,
}: WaveformCanvasProps) {
  const { canvasRef, render } = useWebGL();
  const colors = { ...DEFAULT_COLORS, ...colorOverrides };

  // 拖拽状态
  const dragRef = useRef<{
    startX: number;         // 鼠标按下时的屏幕 X（用于判断是否超过阈值）
    startSec: number;
    currentSec: number;
    isDragging: boolean;    // 是否已确认为拖拽（超过阈值）
  } | null>(null);
  const [dragDisplay, setDragDisplay] = useState<[number, number] | null>(null);

  // ── 坐标转换 ────────────────────────────────────────────────────────────────
  const xToSec = useCallback(
    (x: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const ratio = (x - rect.left) / rect.width;
      return viewRange.startSec + ratio * (viewRange.endSec - viewRange.startSec);
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
      dragRef.current = {
        startX: e.clientX,
        startSec: sec,
        currentSec: sec,
        isDragging: false,
      };
    },
    [xToSec]
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current) return;
      const dx = Math.abs(e.clientX - dragRef.current.startX);
      const sec = xToSec(e.clientX);
      dragRef.current.currentSec = sec;

      if (!dragRef.current.isDragging && dx >= DRAG_THRESHOLD_PX) {
        dragRef.current.isDragging = true;
      }

      if (dragRef.current.isDragging) {
        const s = Math.min(dragRef.current.startSec, sec);
        const en = Math.max(dragRef.current.startSec, sec);
        setDragDisplay([secToRatio(s), secToRatio(en)]);
      }
    },
    [xToSec, secToRatio]
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      if (!dragRef.current) return;
      const sec = xToSec(e.clientX);

      if (dragRef.current.isDragging) {
        // 拖拽：创建标记
        const start = Math.min(dragRef.current.startSec, sec);
        const end = Math.max(dragRef.current.startSec, sec);
        if (end - start >= 0.05) {
          onRegionSelected(start, end);
        }
      } else {
        // 点击：定位播放头
        onSeek(sec);
      }

      dragRef.current = null;
      setDragDisplay(null);
    },
    [xToSec, onRegionSelected, onSeek]
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
        onZoom(e.deltaY, centerSec);
      } else {
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
    const normalizedLabels = labels.map((l) => ({
      start: secToRatio(l.start),
      end: secToRatio(l.end),
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
        cursor: dragDisplay ? "col-resize" : "pointer",
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    />
  );
}