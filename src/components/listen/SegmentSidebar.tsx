import React from "react";
import { C, FONT } from "@/styles";
import type { ListenSegment, SegmentState, SegmentStatus } from "@/types/waveform";

interface SegmentSidebarProps {
  segments: ListenSegment[];
  segStates: Map<number, SegmentState>;
  currentIndex: number;
  onSelect: (i: number) => void;
}

const STATUS_COLOR: Record<SegmentStatus, string> = {
  pending: C.border2,
  done:    C.green,
  flagged: C.red,
};
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

  return (
    <div style={s.sidebar}>
      <div style={s.head}>片段列表</div>

      <div style={s.list}>
        {segments.map((seg) => {
          const state = segStates.get(seg.index) ?? { status: "pending" as SegmentStatus, userText: "" };
          const isActive = seg.index === currentIndex;

          return (
            <div
              key={seg.index}
              style={{
                ...s.item,
                background: isActive ? C.blueLt : "transparent",
                borderLeftColor: isActive ? C.blue : "transparent",
              }}
              onClick={() => onSelect(seg.index)}
            >
              <div style={s.itemTop}>
                <span style={{ ...s.itemNum, color: isActive ? C.blue : C.ink3 }}>
                  #{String(seg.index + 1).padStart(2, "0")}
                </span>
                <span
                  style={{
                    ...s.statusDot,
                    background: STATUS_COLOR[state.status],
                    border: state.status === "pending" ? `1px solid ${C.ink3}` : "none",
                  }}
                  title={STATUS_LABEL[state.status]}
                />
              </div>
              <div style={s.itemTime}>
                {fmtTime(seg.start)} → {fmtTime(seg.end)}
              </div>
              {seg.label && (
                <div style={s.itemLabel}>{seg.label}</div>
              )}
            </div>
          );
        })}
      </div>

      {/* 图例统计 */}
      <div style={s.legend}>
        {(["done", "flagged", "pending"] as SegmentStatus[]).map((st) => (
          <div key={st} style={s.legendRow}>
            <span style={{
              ...s.statusDot,
              background: STATUS_COLOR[st],
              border: st === "pending" ? `1px solid ${C.ink3}` : "none",
            }} />
            <span>{STATUS_LABEL[st]}</span>
            <span style={{ marginLeft: "auto", color: C.ink2 }}>{counts[st]}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  sidebar: {
    width: 264,
    flexShrink: 0,
    display: "flex",
    flexDirection: "column",
    borderRight: `0.5px solid ${C.border}`,
    background: C.paper2,
    overflow: "hidden",
  },
  head: {
    padding: "16px 20px 10px",
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: "0.10em",
    textTransform: "uppercase" as const,
    color: C.ink3,
    flexShrink: 0,
  },
  list: {
    flex: 1,
    overflowY: "auto",
  },
  item: {
    padding: "13px 20px",
    cursor: "pointer",
    borderLeft: "3px solid transparent",
    transition: "background 0.1s, border-color 0.1s",
  },
  itemTop: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 5,
  },
  itemNum: {
    fontFamily: FONT.mono,
    fontSize: 15,
    fontWeight: 600,
  },
  statusDot: {
    display: "inline-block",
    width: 9,
    height: 9,
    borderRadius: "50%",
    flexShrink: 0,
  },
  itemTime: {
    fontFamily: FONT.mono,
    fontSize: 12,
    color: C.ink3,
  },
  itemLabel: {
    fontSize: 13,
    color: C.ink2,
    marginTop: 3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  legend: {
    padding: "14px 20px",
    borderTop: `0.5px solid ${C.border}`,
    display: "flex",
    flexDirection: "column",
    gap: 8,
    flexShrink: 0,
  },
  legendRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    fontSize: 12,
    fontFamily: FONT.mono,
    color: C.ink3,
  },
};