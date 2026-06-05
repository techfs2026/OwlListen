import { useEffect, useRef, useCallback, useState } from "react";
import { useWebGL } from "@/hooks/useWebGL";
import type { Label, RenderData, ViewRange, WaveformColors } from "@/types/waveform";
import { DEFAULT_COLORS } from "@/types/waveform";

interface WaveformCanvasProps {
  data: RenderData | null;
  viewRange: ViewRange;
  duration: number;
  playhead: number;
  labels: Label[];
  selectedId?: string | null;
  overlappingIds?: Set<string>;
  colors?: Partial<WaveformColors>;
  loopRange?: [number, number] | null;
  onSeek: (sec: number) => void;
  onRegionSelected: (start: number, end: number) => void;
  onZoom: (delta: number, centerSec: number) => void;
  onScroll: (deltaSec: number) => void;
  /** 拖动已有 label 边缘时触发 */
  onLabelEdgeDrag: (id: string, edge: "start" | "end", newSec: number) => void;
}

const DRAG_THRESHOLD_PX = 6;
/** label 边缘 hit-test 容差（CSS px）*/
const EDGE_HIT_PX = 8;

type PointerMode =
  | { kind: "idle" }
  | { kind: "maybe-seek"; startX: number; startSec: number }
  | { kind: "region-drag"; startSec: number; currentSec: number }
  | { kind: "label-edge"; id: string; edge: "start" | "end" };

export function WaveformCanvas({
  data,
  viewRange,
  duration,
  playhead,
  labels,
  selectedId = null,
  overlappingIds,
  colors: colorOverrides,
  loopRange,
  onSeek,
  onRegionSelected,
  onZoom,
  onScroll,
  onLabelEdgeDrag,
}: WaveformCanvasProps) {
  const { canvasRef, render } = useWebGL();
  const colors = { ...DEFAULT_COLORS, ...colorOverrides };

  const modeRef = useRef<PointerMode>({ kind: "idle" });
  const [dragDisplay, setDragDisplay] = useState<[number, number] | null>(null);
  const [cursor, setCursor] = useState<string>("crosshair");

  // ── 坐标转换 ──────────────────────────────────────────────────────────────

  const xToSec = useCallback(
    (x: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      const ratio = (x - rect.left) / rect.width;
      return viewRange.startSec + ratio * (viewRange.endSec - viewRange.startSec);
    },
    [canvasRef, viewRange],
  );

  const secToRatio = useCallback(
    (sec: number): number => {
      const dur = viewRange.endSec - viewRange.startSec;
      if (dur <= 0) return 0;
      return (sec - viewRange.startSec) / dur;
    },
    [viewRange],
  );

  const secToPx = useCallback(
    (sec: number): number => {
      const canvas = canvasRef.current;
      if (!canvas) return 0;
      const rect = canvas.getBoundingClientRect();
      return rect.left + secToRatio(sec) * rect.width;
    },
    [canvasRef, secToRatio],
  );

  // ── 边缘 hit-test ──────────────────────────────────────────────────────────

  const hitTestEdge = useCallback(
    (clientX: number): { id: string; edge: "start" | "end" } | null => {
      for (const label of labels) {
        const startPx = secToPx(label.start);
        const endPx = secToPx(label.end);
        if (Math.abs(clientX - endPx) <= EDGE_HIT_PX) {
          return { id: label.id, edge: "end" };
        }
        if (Math.abs(clientX - startPx) <= EDGE_HIT_PX) {
          return { id: label.id, edge: "start" };
        }
      }
      return null;
    },
    [labels, secToPx],
  );

  // ── 鼠标事件 ──────────────────────────────────────────────────────────────

  const handleMouseDown = useCallback(
    (e: React.MouseEvent) => {
      if (e.button !== 0) return;

      const hit = hitTestEdge(e.clientX);
      if (hit) {
        modeRef.current = { kind: "label-edge", id: hit.id, edge: hit.edge };
        setCursor("col-resize");
        return;
      }

      const sec = xToSec(e.clientX);
      modeRef.current = { kind: "maybe-seek", startX: e.clientX, startSec: sec };
    },
    [xToSec, hitTestEdge],
  );

  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      const mode = modeRef.current;

      if (mode.kind === "label-edge") {
        const sec = xToSec(e.clientX);
        onLabelEdgeDrag(mode.id, mode.edge, sec);
        return;
      }

      if (mode.kind === "maybe-seek") {
        const dx = Math.abs(e.clientX - mode.startX);
        if (dx >= DRAG_THRESHOLD_PX) {
          const sec = xToSec(e.clientX);
          modeRef.current = { kind: "region-drag", startSec: mode.startSec, currentSec: sec };
          const s = Math.min(mode.startSec, sec);
          const en = Math.max(mode.startSec, sec);
          setDragDisplay([secToRatio(s), secToRatio(en)]);
          setCursor("col-resize");
        }
        return;
      }

      if (mode.kind === "region-drag") {
        const sec = xToSec(e.clientX);
        modeRef.current = { ...mode, currentSec: sec };
        const s = Math.min(mode.startSec, sec);
        const en = Math.max(mode.startSec, sec);
        setDragDisplay([secToRatio(s), secToRatio(en)]);
        return;
      }

      // idle: hover hit-test → 更新光标
      const hit = hitTestEdge(e.clientX);
      setCursor(hit ? "col-resize" : "crosshair");
    },
    [xToSec, secToRatio, hitTestEdge, onLabelEdgeDrag],
  );

  const handleMouseUp = useCallback(
    (e: React.MouseEvent) => {
      const mode = modeRef.current;

      if (mode.kind === "label-edge") {
        modeRef.current = { kind: "idle" };
        setCursor("crosshair");
        return;
      }

      if (mode.kind === "region-drag") {
        const sec = xToSec(e.clientX);
        const start = Math.min(mode.startSec, sec);
        const end = Math.max(mode.startSec, sec);
        if (end - start >= 0.05) onRegionSelected(start, end);
        modeRef.current = { kind: "idle" };
        setDragDisplay(null);
        setCursor("crosshair");
        return;
      }

      if (mode.kind === "maybe-seek") {
        onSeek(xToSec(e.clientX));
        modeRef.current = { kind: "idle" };
        setCursor("crosshair");
        return;
      }
    },
    [xToSec, onRegionSelected, onSeek],
  );

  const handleMouseLeave = useCallback(() => {
    const mode = modeRef.current;
    if (mode.kind !== "label-edge") {
      // label-edge drag: allow pointer to leave canvas and come back
      if (mode.kind === "region-drag" || mode.kind === "maybe-seek") {
        modeRef.current = { kind: "idle" };
        setDragDisplay(null);
      }
      setCursor("crosshair");
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
        onScroll((e.deltaY / 200) * dur);
      }
    },
    [xToSec, viewRange, onZoom, onScroll],
  );

  // ── 渲染 ──────────────────────────────────────────────────────────────────

  useEffect(() => {
    const playheadRatio = duration > 0 ? secToRatio(playhead) : -1;
    const normalizedLabels = labels.map((l) => ({
      start: secToRatio(l.start),
      end: secToRatio(l.end),
      selected: l.id === selectedId,
      overlapping: overlappingIds?.has(l.id) ?? false,
    }));

    const normalizedLoop = loopRange
      ? ([secToRatio(loopRange[0]), secToRatio(loopRange[1])] as [number, number])
      : null;

    render({
      data,
      playhead: playheadRatio,
      dragRange: dragDisplay,
      labels: normalizedLabels,
      colors,
      loopRange: normalizedLoop,
    });
  }, [
    data,
    playhead,
    duration,
    labels,
    selectedId,
    dragDisplay,
    colors,
    loopRange,
    render,
    secToRatio,
  ]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        width: "100%",
        height: "100%",
        display: "block",
        cursor,
      }}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseLeave}
      onWheel={handleWheel}
    />
  );
}
