import React from "react";
import { C, FONT } from "@/styles";
import type { Label } from "@/types/waveform";

interface LabelListProps {
  labels: Label[];
  duration: number;
  onRemove: (id: string) => void;
  onJumpTo: (start: number, end: number) => void;
  onUpdateText: (id: string, text: string) => void;
}

export function LabelList({ labels, onRemove, onJumpTo, onUpdateText }: LabelListProps) {
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
              onRemove={() => onRemove(label.id)}
              onJumpTo={() => onJumpTo(label.start, label.end)}
              onUpdateText={(text) => onUpdateText(label.id, text)}
            />
          ))}
          {/* 末尾提示占位 */}
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

function LabelCard({ label, index, onRemove, onJumpTo, onUpdateText }: LabelCardProps) {
  return (
    <div style={s.card}>
      <div style={s.cardNum}>#{index}</div>
      <div style={s.cardTimes}>
        <span style={s.t}>{fmtTime(label.start)}</span>
        <span style={s.arrow}>→</span>
        <span style={s.t}>{fmtTime(label.end)}</span>
        <span style={s.dur}>{fmtDur(label.end - label.start)}</span>
      </div>
      <input
        style={s.cardInput}
        value={label.text}
        placeholder="备注"
        onChange={(e) => onUpdateText(e.target.value)}
      />
      <div style={s.cardActions}>
        <button style={s.actionBtn} onClick={onJumpTo}>定位</button>
        <button style={{ ...s.actionBtn, ...s.dangerBtn }} onClick={onRemove}>删除</button>
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
    gap: 8,
    overflowX: "auto",
    padding: "10px 14px",
    background: C.paper2,
    borderTop: `0.5px solid ${C.border}`,
    minHeight: 208,
    maxHeight: 248,
    alignItems: "stretch",
  },
  empty: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
    color: C.ink3,
  },
  emptyIcon: { fontSize: 18, letterSpacing: "0.1em" },
  emptyText: { fontSize: 12, fontFamily: FONT.mono },
  addHint: {
    flexShrink: 0,
    width: 72,
    height: 86,
    border: `1px dashed ${C.border2}`,
    borderRadius: 8,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
    cursor: "default",
    opacity: 0.45,
  },
  addIcon: { fontSize: 20, color: C.ink3, lineHeight: 1 },
  addText: { fontSize: 10, color: C.ink3, textAlign: "center", lineHeight: 1.5 },

  card: {
    flexShrink: 0,
    alignSelf: "stretch",
    minWidth: 240,
    background: C.paper,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 8,
    padding: "9px 11px",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    boxShadow: "0 1px 3px rgba(26,39,68,0.05)",
  },
  cardNum: {
    fontFamily: FONT.mono,
    fontSize: 20,
    fontWeight: 500,
    color: C.blue,
  },
  cardTimes: {
    display: "flex",
    alignItems: "center",
    gap: 3,
    fontFamily: FONT.mono,
    fontSize: 12,
    flexWrap: "wrap",
  },
  t: { color: C.ink, fontWeight: 500 },
  arrow: { color: C.ink3 },
  dur: { color: C.ink3, fontSize: 9.5 },
  cardInput: {
    background: C.paper2,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 4,
    color: C.ink2,
    fontSize: 14,
    padding: "3px 6px",
    width: "100%",
    outline: "none",
  },
  cardActions: { display: "flex", gap: 4 },
  actionBtn: {
    flex: 1,
    background: "transparent",
    border: `0.5px solid ${C.border2}`,
    borderRadius: 4,
    color: C.ink3,
    fontSize: 16,
    fontWeight: 500,
    padding: "3px 0",
    cursor: "pointer",
    fontFamily: FONT.sans,
  },
  dangerBtn: {
    borderColor: "#FCA5A5",
    color: C.red,
  },
};