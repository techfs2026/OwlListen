import React from "react";
import { C, FONT } from "@/styles";
import type { DiffResult } from "@/hooks/useDiff";

interface DiffViewProps {
  result: DiffResult;
}

export function DiffView({ result }: DiffViewProps) {
  const { ops, correct, wrong, missing, accuracy } = result;

  return (
    <div style={s.wrap}>
      {/* 头部：图例 + 统计 */}
      <div style={s.head}>
        <div style={s.headLeft}>
          <span style={s.headLabel}>原文对照</span>
          <span style={s.legend}>
            <span style={s.dotOk} />正确
          </span>
          <span style={s.legend}>
            <span style={s.dotWrong} />多余
          </span>
          <span style={s.legend}>
            <span style={s.dotMiss} />缺失
          </span>
        </div>
        <div style={s.scoreRow}>
          <ScoreChip label="✓" value={correct} color={C.green} bg={C.greenLt} />
          <ScoreChip label="✗" value={wrong}   color={C.red}   bg={C.redLt} />
          <ScoreChip label="?" value={missing}  color={C.amber} bg={C.amberLt} />
          <div style={s.accuracy}>
            准确率&nbsp;
            <strong style={{ color: accuracyColor(accuracy) }}>
              {Math.round(accuracy * 100)}%
            </strong>
          </div>
        </div>
      </div>

      {/* Diff 正文 */}
      <div style={s.body}>
        {ops.length === 0 ? (
          <span style={{ color: C.ink3, fontStyle: "italic", fontSize: 13 }}>（暂无内容）</span>
        ) : (
          ops.map((op, i) => {
            if (op.type === "ok") {
              return (
                <span key={i} style={s.wordOk}>{op.word} </span>
              );
            }
            if (op.type === "del") {
              return (
                <span key={i} style={s.wordWrong} title="你多写了这个词">
                  {op.word}{" "}
                </span>
              );
            }
            // ins = missing
            return (
              <span key={i} style={s.wordMiss} title="原文有但你漏掉了">
                [{op.word}]{" "}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

function ScoreChip({ label, value, color, bg }: {
  label: string; value: number; color: string; bg: string;
}) {
  return (
    <span style={{
      fontFamily: FONT.mono,
      fontSize: 11,
      color,
      background: bg,
      borderRadius: 4,
      padding: "1px 7px",
      display: "inline-flex",
      alignItems: "center",
      gap: 3,
    }}>
      {label} {value}
    </span>
  );
}

function accuracyColor(acc: number): string {
  if (acc >= 0.9) return C.green;
  if (acc >= 0.6) return C.amber;
  return C.red;
}

const s: Record<string, React.CSSProperties> = {
  wrap: {
    border: `0.5px solid ${C.border2}`,
    borderRadius: 10,
    overflow: "hidden",
    flexShrink: 0,
  },
  head: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "7px 13px",
    background: C.paper3,
    borderBottom: `0.5px solid ${C.border}`,
    gap: 12,
    flexWrap: "wrap",
  },
  headLeft: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  headLabel: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: "0.10em",
    textTransform: "uppercase" as const,
    color: C.ink3,
    marginRight: 4,
  },
  legend: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: C.ink3,
  },
  dotOk:    { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: C.green },
  dotWrong: { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: C.red },
  dotMiss:  { display: "inline-block", width: 7, height: 7, borderRadius: "50%", background: C.amber },
  scoreRow: {
    display: "flex",
    alignItems: "center",
    gap: 6,
  },
  accuracy: {
    fontSize: 11,
    color: C.ink3,
    fontFamily: FONT.mono,
    marginLeft: 4,
  },
  body: {
    padding: "12px 14px",
    lineHeight: 2,
    fontSize: 14,
    background: C.paper,
    minHeight: 52,
    wordBreak: "break-word" as const,
  },
  wordOk: {
    color: C.green,
    background: C.greenLt,
    borderRadius: 3,
    padding: "1px 3px",
  },
  wordWrong: {
    color: C.red,
    background: C.redLt,
    borderRadius: 3,
    padding: "1px 3px",
    textDecoration: "line-through",
    textDecorationColor: `${C.red}88`,
  },
  wordMiss: {
    color: C.amber,
    background: C.amberLt,
    borderRadius: 3,
    padding: "1px 3px",
    fontStyle: "italic",
  },
};