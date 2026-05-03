import { useMemo } from "react";
import { C, FONT } from "@/styles";

interface TimeAxisProps {
  viewRange: { startSec: number; endSec: number };
  width: number; // container px width (used to choose tick density)
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  if (m === 0) return `${s.toFixed(1)}s`;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(0)}`;
}

/** 根据视图时长自动选合适的刻度间隔 */
function chooseTick(dur: number): number {
  const targets = [0.1, 0.25, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];
  // 目标约 8~12 个刻度
  const ideal = dur / 10;
  return targets.reduce((prev, cur) =>
    Math.abs(cur - ideal) < Math.abs(prev - ideal) ? cur : prev
  );
}

export function TimeAxis({ viewRange, width }: TimeAxisProps) {
  const { startSec, endSec } = viewRange;
  const dur = endSec - startSec;

  const ticks = useMemo(() => {
    if (dur <= 0 || width <= 0) return [];
    const interval = chooseTick(dur);
    const first = Math.ceil(startSec / interval) * interval;
    const result: number[] = [];
    for (let t = first; t <= endSec + 1e-9; t += interval) {
      result.push(parseFloat(t.toFixed(6)));
    }
    return result;
  }, [startSec, endSec, dur, width]);

  return (
    <div style={{
      position: "relative",
      height: 24,
      borderTop: `0.5px solid ${C.border}`,
      background: C.paper,
      flexShrink: 0,
    }}>
      {ticks.map((t) => {
        const pct = ((t - startSec) / dur) * 100;
        if (pct < 0 || pct > 100) return null;
        return (
          <div key={t} style={{
            position: "absolute",
            left: `${pct}%`,
            top: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            transform: "translateX(-50%)",
          }}>
            <div style={{ width: 0.5, height: 5, background: C.ink3 }} />
            <span style={{
              fontFamily: FONT.mono,
              fontSize: 9,
              color: C.ink3,
              marginTop: 2,
              whiteSpace: "nowrap",
              userSelect: "none",
            }}>
              {formatTime(t)}
            </span>
          </div>
        );
      })}
    </div>
  );
}