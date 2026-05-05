import type { DiffResult } from "@/hooks/useDiff";
import "./DiffView.scss";

interface DiffViewProps {
  result: DiffResult;
}

export function DiffView({ result }: DiffViewProps) {
  const { ops, correct, wrong, missing, accuracy } = result;

  return (
    <div className="diff-view">
      {/* 头部：图例 + 统计 */}
      <div className="diff-view__head">
        <div className="diff-view__head-left">
          <span className="diff-view__head-label">原文对照</span>
          <span className="diff-view__legend">
            <span className="diff-view__dot diff-view__dot--ok" />正确
          </span>
          <span className="diff-view__legend">
            <span className="diff-view__dot diff-view__dot--wrong" />多余
          </span>
          <span className="diff-view__legend">
            <span className="diff-view__dot diff-view__dot--missing" />缺失
          </span>
        </div>
        <div className="diff-view__score-row">
          <span className="score-chip score-chip--ok">✓ {correct}</span>
          <span className="score-chip score-chip--wrong">✗ {wrong}</span>
          <span className="score-chip score-chip--missing">? {missing}</span>
          <div className="diff-view__accuracy">
            准确率&nbsp;
            <strong style={{ color: accuracyColor(accuracy) }}>
              {Math.round(accuracy * 100)}%
            </strong>
          </div>
        </div>
      </div>

      {/* Diff 正文 */}
      <div className="diff-view__body">
        {ops.length === 0 ? (
          <span className="diff-view__empty">（暂无内容）</span>
        ) : (
          ops.map((op, i) => {
            if (op.type === "ok") {
              return <span key={i} className="diff-view__word diff-view__word--ok">{op.word} </span>;
            }
            if (op.type === "del") {
              return (
                <span key={i} className="diff-view__word diff-view__word--wrong" title="你多写了这个词">
                  {op.word}{" "}
                </span>
              );
            }
            // ins = missing
            return (
              <span key={i} className="diff-view__word diff-view__word--missing" title="原文有但你漏掉了">
                [{op.word}]{" "}
              </span>
            );
          })
        )}
      </div>
    </div>
  );
}

function accuracyColor(acc: number): string {
  if (acc >= 0.9) return "var(--color-success)";
  if (acc >= 0.6) return "var(--color-warning)";
  return "var(--color-danger)";
}