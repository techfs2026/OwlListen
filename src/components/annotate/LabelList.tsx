import React from "react";
import { C, FONT } from "@/styles";
import type { Label } from "@/types/waveform";

interface LabelListProps {
  labels: Label[];
  duration: number;
  selectedId: string | null;
  overlappingIds: Set<string>;
  onSelect: (id: string) => void;
  onRemove: (id: string) => void;
  onJumpTo: (start: number, end: number) => void;
  onUpdateText: (id: string, text: string) => void;
}

export function LabelList({ labels, selectedId, overlappingIds, onSelect, onRemove, onJumpTo, onUpdateText }: LabelListProps) {
  return (
    <div style={s.container}>
      {labels.length === 0 ? (
        <div style={s.empty}>
          <span style={s.emptyIcon}>⋯</span>
          <span style={s.emptyText}>在波形上拖拽鼠标来添加标注片段</span>
        </div>
      ) : (
        <>
          {labels.map((label, idx) => (
            <LabelCard
              key={label.id}
              label={label}
              index={idx + 1}
              selected={label.id === selectedId}
              overlapping={overlappingIds.has(label.id)}
              onSelect={() => onSelect(label.id)}
              onRemove={() => onRemove(label.id)}
              onJumpTo={() => onJumpTo(label.start, label.end)}
              onUpdateText={(text) => onUpdateText(label.id, text)}
            />
          ))}
          <div style={s.addHint}>
            <div style={s.addIcon}>+</div>
            <div style={s.addText}>拖拽添加<br />片段</div>
          </div>
        </>
      )}
    </div>
  );
}

// ── 单张标注卡 ─────────────────────────────────────────────────────────────────

interface LabelCardProps {
  label: Label;
  index: number;
  selected: boolean;
  overlapping: boolean;
  onSelect: () => void;
  onRemove: () => void;
  onJumpTo: () => void;
  onUpdateText: (text: string) => void;
}

function fmtTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(2)}`;
}

function fmtDur(sec: number): string {
  return sec < 1 ? `${(sec * 1000).toFixed(0)}ms` : `${sec.toFixed(2)}s`;
}

function LabelCard({ label, index, selected, overlapping, onSelect, onRemove, onJumpTo, onUpdateText }: LabelCardProps) {
  const cardStyle: React.CSSProperties = {
    ...s.card,
    borderColor: overlapping ? "#FCA5A5" : selected ? C.blue : undefined,
    boxShadow: overlapping
      ? "0 0 0 2px #FEE2E2"
      : selected
      ? `0 0 0 2px ${C.blueLt}, 0 1px 3px rgba(26,39,68,0.08)`
      : "0 1px 3px rgba(26,39,68,0.05)",
    background: overlapping ? "#FFF5F5" : selected ? C.blueLt : C.paper,
  };

  return (
    <div style={cardStyle} onClick={onSelect}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
        <div style={{ ...s.cardNum, color: overlapping ? "#DC2626" : selected ? C.blue : C.ink3 }}>#{index}</div>
        <div style={{ display: "flex", gap: 5, alignItems: "center" }}>
          {overlapping && <div style={s.overlapBadge}>⚠ 重叠</div>}
          {selected && !overlapping && (
            <div style={s.selectedBadge}><span style={s.selectedDot} />选中</div>
          )}
        </div>
      </div>
      <div style={s.cardTimes}>
        <span style={s.t}>{fmtTime(label.start)}</span>
        <span style={s.arrow}>→</span>
        <span style={s.t}>{fmtTime(label.end)}</span>
        <span style={s.dur}>{fmtDur(label.end - label.start)}</span>
      </div>
      {selected && (
        <div style={s.nudgeHint}>
          <kbd style={s.kbdTiny}>←→</kbd><span>切换区段</span>
        </div>
      )}
      <input
        style={s.cardInput}
        value={label.text}
        placeholder="备注"
        onClick={(e) => e.stopPropagation()}
        onChange={(e) => onUpdateText(e.target.value)}
      />
      <div style={s.cardActions}>
        <button style={s.actionBtn} onClick={(e) => { e.stopPropagation(); onJumpTo(); }}>定位</button>
        <button style={{ ...s.actionBtn, ...s.dangerBtn }} onClick={(e) => { e.stopPropagation(); onRemove(); }}>删除</button>
      </div>
    </div>
  );
}

// ── 样式 ──────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexShrink: 0,
    flexDirection: "row",
    gap: 10,
    overflowX: "auto",
    padding: "14px 18px",
    background: C.paper2,
    borderTop: `0.5px solid ${C.border}`,
    minHeight: 265,
    maxHeight: 315,
    alignItems: "stretch",
  },
  empty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 10,
    color: C.ink3,
  },
  emptyIcon: { fontSize: 20, letterSpacing: "0.1em" },
  emptyText: { fontSize: 13, fontFamily: FONT.mono },
  addHint: {
    flexShrink: 0,
    width: 84,
    height: 96,
    border: `1px dashed ${C.border2}`,
    borderRadius: 10,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
    cursor: "default",
    opacity: 0.45,
  },
  addIcon: { fontSize: 22, color: C.ink3, lineHeight: 1 },
  addText: { fontSize: 11, color: C.ink3, textAlign: "center", lineHeight: 1.5 },

  card: {
    flexShrink: 0,
    alignSelf: "stretch",
    minWidth: 270,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 10,
    padding: "12px 14px",
    display: "flex",
    flexDirection: "column",
    gap: 7,
    cursor: "pointer",
    transition: "box-shadow 0.12s, border-color 0.12s, background 0.12s",
  },
  cardNum: {
    fontFamily: FONT.mono,
    fontSize: 22,
    fontWeight: 500,
  },
  selectedBadge: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    fontFamily: FONT.mono,
    color: C.blue,
    background: "#DBEAFE",
    border: `0.5px solid ${C.blueMid}55`,
    borderRadius: 8,
    padding: "2px 7px",
    letterSpacing: "0.04em",
  },
  overlapBadge: {
    fontSize: 10,
    fontFamily: FONT.mono,
    color: "#DC2626",
    background: "#FEE2E2",
    border: "0.5px solid #FCA5A5",
    borderRadius: 8,
    padding: "2px 7px",
    letterSpacing: "0.04em",
    fontWeight: 600,
  },
  selectedDot: {
    width: 5,
    height: 5,
    borderRadius: "50%",
    background: C.blue,
    display: "inline-block",
  },
  nudgeHint: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 10,
    color: C.ink3,
    fontFamily: FONT.mono,
    marginTop: -2,
  },
  nudgeSep: { color: C.border2, fontSize: 10 },
  kbdTiny: {
    fontFamily: FONT.mono,
    fontSize: 9,
    color: C.ink3,
    background: C.paper,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 3,
    padding: "1px 4px",
    lineHeight: 1.2,
  },
  cardTimes: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontFamily: FONT.mono,
    fontSize: 13,
    flexWrap: "wrap",
  },
  t: { color: C.ink, fontWeight: 500 },
  arrow: { color: C.ink3 },
  dur: { color: C.ink3, fontSize: 11 },
  cardInput: {
    background: C.paper2,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 5,
    color: C.ink2,
    fontSize: 14,
    padding: "5px 8px",
    width: "100%",
    outline: "none",
  },
  cardActions: { display: "flex", gap: 5 },
  actionBtn: {
    flex: 1,
    background: "transparent",
    border: `0.5px solid ${C.border2}`,
    borderRadius: 5,
    color: C.ink3,
    fontSize: 13,
    fontWeight: 500,
    padding: "5px 0",
    cursor: "pointer",
    fontFamily: FONT.sans,
  },
  dangerBtn: {
    borderColor: "#FCA5A5",
    color: C.red,
  },
};