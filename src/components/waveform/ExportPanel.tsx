import { useEffect, useRef } from "react";

export type ExportStep =
    | "idle"
    | "splitting"
    | "transcribing"
    | "zipping"
    | "done"
    | "error";

export interface ExportProgress {
    step: ExportStep;
    /** 转写进度：已完成条目数 */
    transcribed: number;
    total: number;
    /** 最终 ZIP 路径 */
    outputPath?: string;
    errorMsg?: string;
}

interface ExportPanelProps {
    progress: ExportProgress;
    onClose: () => void;
    onReveal: (path: string) => void;
}

const STEP_LABELS: Record<ExportStep, string> = {
    idle: "",
    splitting: "切割音频片段…",
    transcribing: "Whisper 转写中…",
    zipping: "打包 ZIP…",
    done: "导出完成",
    error: "导出失败",
};

export function ExportPanel({ progress, onClose, onReveal }: ExportPanelProps) {
    const { step, transcribed, total, outputPath, errorMsg } = progress;

    const pct =
        step === "done"
            ? 100
            : step === "splitting"
                ? 10
                : step === "transcribing" && total > 0
                    ? Math.round(10 + (transcribed / total) * 80)
                    : step === "zipping"
                        ? 95
                        : 0;

    return (
        <div style={styles.overlay}>
            <div style={styles.panel}>
                {/* 标题行 */}
                <div style={styles.header}>
                    <span style={styles.title}>
                        {step === "done" ? "✓ 导出完成" : step === "error" ? "✗ 导出失败" : "正在导出…"}
                    </span>
                    {(step === "done" || step === "error") && (
                        <button style={styles.closeBtn} onClick={onClose}>✕</button>
                    )}
                </div>

                {/* 进度条 */}
                {step !== "done" && step !== "error" && (
                    <div style={styles.barTrack}>
                        <div
                            style={{
                                ...styles.barFill,
                                width: `${pct}%`,
                                transition: "width 0.4s ease",
                            }}
                        />
                    </div>
                )}

                {/* 步骤状态 */}
                <div style={styles.steps}>
                    <StepRow
                        icon="✂"
                        label="切割音频"
                        state={
                            step === "splitting" ? "active"
                                : ["transcribing", "zipping", "done"].includes(step) ? "done"
                                    : "pending"
                        }
                    />
                    <StepRow
                        icon="⌨"
                        label={
                            step === "transcribing" && total > 0
                                ? `Whisper 转写 (${transcribed}/${total})`
                                : "Whisper 转写"
                        }
                        state={
                            step === "transcribing" ? "active"
                                : ["zipping", "done"].includes(step) ? "done"
                                    : "pending"
                        }
                    />
                    <StepRow
                        icon="📦"
                        label="打包 ZIP"
                        state={
                            step === "zipping" ? "active"
                                : step === "done" ? "done"
                                    : "pending"
                        }
                    />
                </div>

                {/* 完成后显示路径 */}
                {step === "done" && outputPath && (
                    <div style={styles.result}>
                        <span style={styles.resultPath}>{outputPath}</span>
                        <button style={styles.revealBtn} onClick={() => onReveal(outputPath)}>
                            在 Finder 中显示
                        </button>
                    </div>
                )}

                {/* 错误信息 */}
                {step === "error" && errorMsg && (
                    <div style={styles.errorBox}>{errorMsg}</div>
                )}
            </div>
        </div>
    );
}

function StepRow({
    icon,
    label,
    state,
}: {
    icon: string;
    label: string;
    state: "pending" | "active" | "done";
}) {
    return (
        <div style={{ ...styles.stepRow, opacity: state === "pending" ? 0.4 : 1 }}>
            <span style={{
                ...styles.stepIcon,
                color: state === "done" ? "#16A34A" : state === "active" ? "#2563EB" : "#94A3B8",
            }}>
                {state === "done" ? "✓" : state === "active" ? <Spinner /> : icon}
            </span>
            <span style={{
                ...styles.stepLabel,
                color: state === "active" ? "#1E293B" : state === "done" ? "#374151" : "#94A3B8",
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
            display: "inline-block",
            width: 12,
            height: 12,
            border: "2px solid #BFDBFE",
            borderTop: "2px solid #2563EB",
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
        }} />
    );
}

const styles: Record<string, React.CSSProperties> = {
    overlay: {
        position: "fixed",
        inset: 0,
        background: "rgba(15,23,42,0.45)",
        backdropFilter: "blur(4px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 100,
    },
    panel: {
        background: "#FFFFFF",
        border: "1px solid #E2E8F0",
        borderRadius: 14,
        padding: "24px 28px",
        width: 360,
        boxShadow: "0 20px 60px rgba(0,0,0,0.15)",
        display: "flex",
        flexDirection: "column",
        gap: 16,
    },
    header: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    title: {
        fontSize: 15,
        fontWeight: 700,
        color: "#0F172A",
        letterSpacing: "-0.3px",
    },
    closeBtn: {
        background: "transparent",
        border: "none",
        color: "#94A3B8",
        cursor: "pointer",
        fontSize: 14,
        padding: 2,
    },
    barTrack: {
        height: 4,
        background: "#F1F5F9",
        borderRadius: 2,
        overflow: "hidden",
    },
    barFill: {
        height: "100%",
        background: "linear-gradient(90deg, #3B82F6, #2563EB)",
        borderRadius: 2,
    },
    steps: {
        display: "flex",
        flexDirection: "column",
        gap: 10,
    },
    stepRow: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        transition: "opacity 0.2s",
    },
    stepIcon: {
        width: 18,
        height: 18,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        flexShrink: 0,
    },
    stepLabel: {
        fontSize: 13,
        transition: "color 0.2s, font-weight 0.2s",
    },
    result: {
        background: "#F0FDF4",
        border: "1px solid #BBF7D0",
        borderRadius: 8,
        padding: "10px 12px",
        display: "flex",
        flexDirection: "column",
        gap: 8,
    },
    resultPath: {
        fontSize: 11,
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        color: "#15803D",
        wordBreak: "break-all",
    },
    revealBtn: {
        alignSelf: "flex-start",
        background: "transparent",
        border: "1px solid #86EFAC",
        borderRadius: 5,
        color: "#16A34A",
        fontSize: 11,
        fontWeight: 500,
        padding: "3px 10px",
        cursor: "pointer",
    },
    errorBox: {
        background: "#FFF1F2",
        border: "1px solid #FECACA",
        borderRadius: 8,
        padding: "10px 12px",
        fontSize: 12,
        color: "#B91C1C",
        fontFamily: "'SF Mono', 'Fira Code', monospace",
        wordBreak: "break-all",
    },
};