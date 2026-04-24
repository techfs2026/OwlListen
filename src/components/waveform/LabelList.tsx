import type { Label } from "@/types/waveform";

interface LabelListProps {
  labels: Label[];
  duration: number;
  onRemove: (id: string) => void;
  onJumpTo: (start: number, end: number) => void;
  onUpdateText: (id: string, text: string) => void;
}

export function LabelList({
  labels,
  onRemove,
  onJumpTo,
  onUpdateText,
}: LabelListProps) {
  if (labels.length === 0) return null;

  return (
    <div style={styles.container}>
      {labels.map((label, idx) => (
        <div key={label.id} style={styles.card}>
          <div style={styles.index}>#{idx + 1}</div>

          <div style={styles.times}>
            <span style={styles.time}>{formatTime(label.start)}</span>
            <span style={styles.arrow}>→</span>
            <span style={styles.time}>{formatTime(label.end)}</span>
            <span style={styles.duration}>
              {formatDuration(label.end - label.start)}
            </span>
          </div>

          <input
            style={styles.textInput}
            value={label.text}
            placeholder="备注"
            onChange={(e) => onUpdateText(label.id, e.target.value)}
          />

          <div style={styles.actions}>
            <button
              style={styles.btn}
              onClick={() => onJumpTo(label.start, label.end)}
              title="定位到该片段"
            >
              定位
            </button>
            <button
              style={{ ...styles.btn, ...styles.btnDanger }}
              onClick={() => onRemove(label.id)}
              title="删除标记"
            >
              删除
            </button>
          </div>
        </div>
      ))}
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(2)}`;
}

function formatDuration(sec: number): string {
  if (sec < 1) return `${(sec * 1000).toFixed(0)}ms`;
  return `${sec.toFixed(2)}s`;
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "row",
    gap: 8,
    overflowX: "auto",
    padding: "10px 14px",
    background: "#F8FAFF",
    borderTop: "1px solid #E2E8F0",
    minHeight: 112,
    maxHeight: 132,
  },
  card: {
    flexShrink: 0,
    width: 164,
    background: "#FFFFFF",
    border: "1px solid #E2E8F0",
    borderRadius: 8,
    padding: "9px 11px",
    display: "flex",
    flexDirection: "column",
    gap: 5,
    boxShadow: "0 1px 3px rgba(0,0,0,0.05)",
  },
  index: {
    fontSize: 11,
    fontWeight: 700,
    color: "#2563EB",
    letterSpacing: "0.3px",
  },
  times: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    color: "#374151",
    flexWrap: "wrap",
  },
  time: { color: "#1E293B", fontWeight: 500 },
  arrow: { color: "#94A3B8" },
  duration: { color: "#94A3B8", fontSize: 10 },
  textInput: {
    background: "#F8FAFC",
    border: "1px solid #E2E8F0",
    borderRadius: 5,
    color: "#374151",
    fontSize: 11,
    padding: "3px 7px",
    outline: "none",
    width: "100%",
    boxSizing: "border-box",
    transition: "border-color 0.15s",
  },
  actions: {
    display: "flex",
    gap: 4,
    marginTop: 1,
  },
  btn: {
    flex: 1,
    background: "transparent",
    border: "1px solid #E2E8F0",
    borderRadius: 5,
    color: "#64748B",
    fontSize: 10,
    fontWeight: 500,
    padding: "3px 0",
    cursor: "pointer",
  },
  btnDanger: {
    borderColor: "#FCA5A5",
    color: "#DC2626",
  },
};