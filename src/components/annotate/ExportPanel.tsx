import { Btn, Overlay, Card } from "@/components/shared/Primitives";

export type ExportStep = "idle" | "splitting" | "transcribing" | "zipping" | "done" | "error";

export interface ExportProgress {
  step: ExportStep;
  transcribed: number;
  total: number;
  outputPath?: string;
  errorMsg?: string;
}

interface ExportPanelProps {
  progress: ExportProgress;
  onClose: () => void;
  onReveal: (path: string) => void;
}

const STEP_PCT: Record<ExportStep, number> = {
  idle: 0, splitting: 10, transcribing: 0, zipping: 95, done: 100, error: 0,
};

export function ExportPanel({ progress, onClose, onReveal }: ExportPanelProps) {
  const { step, transcribed, total, outputPath, errorMsg } = progress;

  const pct =
    step === "transcribing" && total > 0
      ? Math.round(10 + (transcribed / total) * 80)
      : STEP_PCT[step];

  const isDone = step === "done";
  const isError = step === "error";
  const isFinished = isDone || isError;

  return (
    <Overlay>
      <Card style={{ width: 360, padding: "24px 28px", display: "flex", flexDirection: "column", gap: 16 }}>
        {/* 标题行 */}
        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
          <span style={{ fontFamily: "var(--font-sans)", fontSize: 16, fontWeight: 700, color: "var(--color-ink-1)", letterSpacing: "-0.3px" }}>
            {isDone ? "✓ 导出完成" : isError ? "✗ 导出失败" : "正在导出…"}
          </span>
          {isFinished && (
            <button onClick={onClose} style={{ background: "none", border: "none", color: "var(--color-ink-3)", cursor: "pointer", fontSize: 14 }}>✕</button>
          )}
        </div>

        {/* 进度条 */}
        {!isFinished && (
          <div style={{ height: 3, background: "var(--color-paper-2)", borderRadius: 2, overflow: "hidden" }}>
            <div style={{
              height: "100%",
              width: `${pct}%`,
              background: `linear-gradient(90deg, var(--color-brand), var(--color-brand-mid))`,
              borderRadius: 2,
              transition: "width 0.4s ease",
            }} />
          </div>
        )}

        {/* 步骤列表 */}
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <StepRow icon="✂" label="切割音频"
            state={step === "splitting" ? "active" : ["transcribing","zipping","done"].includes(step) ? "done" : "pending"} />
          <StepRow
            icon="⌨"
            label={step === "transcribing" && total > 0 ? `Whisper 转写 (${transcribed}/${total})` : "Whisper 转写"}
            state={step === "transcribing" ? "active" : ["zipping","done"].includes(step) ? "done" : "pending"}
          />
          <StepRow icon="📦" label="打包 ZIP"
            state={step === "zipping" ? "active" : step === "done" ? "done" : "pending"} />
        </div>

        {/* 完成：显示路径 */}
        {isDone && outputPath && (
          <div style={{
            background: "var(--color-success-soft)", border: `0.5px solid rgba(22,101,52,0.2)`,
            borderRadius: 8, padding: "10px 12px",
            display: "flex", flexDirection: "column", gap: 8,
          }}>
            <span style={{ fontFamily: "var(--font-mono)", fontSize: 11, color: "var(--color-success)", wordBreak: "break-all" }}>
              {outputPath}
            </span>
            <Btn variant="success" size="sm" style={{ alignSelf: "flex-start" }}
              onClick={() => onReveal(outputPath)}>
              在 Finder 中显示
            </Btn>
          </div>
        )}

        {/* 错误 */}
        {isError && errorMsg && (
          <div style={{
            background: "var(--color-danger-soft)", border: `0.5px solid rgba(192,57,43,0.2)`,
            borderRadius: 8, padding: "10px 12px",
            fontFamily: "var(--font-mono)", fontSize: 12, color: "var(--color-danger)", wordBreak: "break-all",
          }}>
            {errorMsg}
          </div>
        )}
      </Card>
    </Overlay>
  );
}

function StepRow({ icon, label, state }: { icon: string; label: string; state: "pending" | "active" | "done" }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, opacity: state === "pending" ? 0.38 : 1 }}>
      <span style={{
        width: 18, height: 18, display: "flex", alignItems: "center", justifyContent: "center",
        fontSize: 12, flexShrink: 0,
        color: state === "done" ? "var(--color-success)" : state === "active" ? "var(--color-brand)" : "var(--color-ink-3)",
      }}>
        {state === "done" ? "✓" : state === "active" ? <Spinner /> : icon}
      </span>
      <span style={{
        fontSize: 14,
        color: state === "active" ? "var(--color-ink-1)" : state === "done" ? "var(--color-ink-2)" : "var(--color-ink-3)",
        fontWeight: state === "active" ? 600 : 400,
      }}>
        {label}
      </span>
    </div>
  );
}

function Spinner() {
  return (
    <span style={{
      display: "inline-block", width: 12, height: 12,
      border: `2px solid var(--color-brand-soft)`, borderTop: `2px solid var(--color-brand)`,
      borderRadius: "50%", animation: "spin 0.8s linear infinite",
    }} />
  );
}