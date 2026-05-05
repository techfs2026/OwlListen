import { useEffect, useRef } from "react";
import type { ListenSegment, SegmentState, SegmentStatus } from "@/types/waveform";
import "./SegmentSidebar.scss";

interface SegmentSidebarProps {
  segments: ListenSegment[];
  segStates: Map<number, SegmentState>;
  currentIndex: number;
  onSelect: (i: number) => void;
}

const STATUS_LABEL: Record<SegmentStatus, string> = {
  pending: "待练",
  done:    "已完成",
  flagged: "重听",
};

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

export function SegmentSidebar({ segments, segStates, currentIndex, onSelect }: SegmentSidebarProps) {
  const counts = { pending: 0, done: 0, flagged: 0 };
  for (const st of segStates.values()) counts[st.status]++;

  const itemRefs = useRef<Map<number, HTMLDivElement>>(new Map());

  useEffect(() => {
    itemRefs.current.get(currentIndex)?.scrollIntoView({
      block: "nearest",
      behavior: "smooth",
    });
  }, [currentIndex]);

  return (
    <div className="seg-sidebar">
      <div className="seg-sidebar__head">片段列表</div>

      <div className="seg-sidebar__list">
        {segments.map((seg) => {
          const state = segStates.get(seg.index) ?? { status: "pending" as SegmentStatus, userText: "" };
          const isActive = seg.index === currentIndex;

          return (
            <div
              key={seg.index}
              ref={(el) => {
                if (el) itemRefs.current.set(seg.index, el);
                else itemRefs.current.delete(seg.index);
              }}
              className={`seg-item${isActive ? " seg-item--active" : ""}`}
              onClick={() => onSelect(seg.index)}
            >
              <div className="seg-item__top">
                <span className="seg-item__num">
                  #{String(seg.index + 1).padStart(2, "0")}
                </span>
                <span
                  className={`seg-item__dot seg-item__dot--${state.status}`}
                  title={STATUS_LABEL[state.status]}
                />
              </div>
              <div className="seg-item__time">
                {fmtTime(seg.start)} → {fmtTime(seg.end)}
              </div>
              {seg.label && (
                <div className="seg-item__label">{seg.label}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 图例统计 */}
      <div className="seg-sidebar__legend">
        {(["done", "flagged", "pending"] as SegmentStatus[]).map((st) => (
          <div key={st} className="seg-sidebar__legend-row">
            <span className={`seg-item__dot seg-item__dot--${st}`} />
            <span>{STATUS_LABEL[st]}</span>
            <span className="seg-sidebar__legend-count">{counts[st]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}