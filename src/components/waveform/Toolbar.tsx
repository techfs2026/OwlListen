import type { AudioInfo, LoadingState } from "@/types/waveform";

interface ToolbarProps {
  audioInfo: AudioInfo | null;
  loadingState: LoadingState;
  labelCount: number;
  labelingMode: boolean;
  playhead: number;
  onOpenAudio: () => void;
  onSaveLabels: () => void;
  onLoadLabels: () => void;
  onClearLabels: () => void;
  onToggleLabelingMode: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function Toolbar({
  audioInfo,
  loadingState,
  labelCount,
  labelingMode,
  playhead,
  onOpenAudio,
  onSaveLabels,
  onLoadLabels,
  onClearLabels,
  onToggleLabelingMode,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: ToolbarProps) {
  const isReady = loadingState === "ready";

  return (
    <div style={styles.bar}>
      {/* 文件操作 */}
      <div style={styles.group}>
        <button style={styles.btnPrimary} onClick={onOpenAudio}>
          打开音频
        </button>
        <div style={styles.sep} />
        <button style={styles.btn} onClick={onLoadLabels} disabled={!isReady}>
          载入标记
        </button>
        <button style={styles.btn} onClick={onSaveLabels} disabled={labelCount === 0}>
          保存标记
        </button>
        <button style={styles.btn} onClick={onClearLabels} disabled={labelCount === 0}>
          清空
        </button>
      </div>

      {/* 模式切换 */}
      <div style={styles.group}>
        <div style={styles.sep} />
        <button
          style={{
            ...styles.btn,
            ...(labelingMode ? styles.btnActive : {}),
          }}
          onClick={onToggleLabelingMode}
          disabled={!isReady}
          title={labelingMode ? "拖拽波形添加标记" : "单击定位播放位置"}
        >
          {labelingMode ? "● 标记模式" : "○ 浏览模式"}
        </button>
      </div>

      {/* 缩放 */}
      <div style={styles.group}>
        <div style={styles.sep} />
        <button style={styles.btnIcon} onClick={onZoomIn}  disabled={!isReady} title="放大（Ctrl+滚轮）">+</button>
        <button style={styles.btnIcon} onClick={onZoomOut} disabled={!isReady} title="缩小">−</button>
        <button style={styles.btn} onClick={onZoomReset} disabled={!isReady}>全览</button>
      </div>

      {/* 弹簧 */}
      <div style={{ flex: 1 }} />

      {/* 状态信息 */}
      <div style={styles.info}>
        {loadingState === "decoding" && (
          <span style={styles.loading}>解码中…</span>
        )}
        {loadingState === "error" && (
          <span style={styles.error}>加载失败</span>
        )}
        {isReady && audioInfo && (
          <>
            <span style={styles.time}>
              {formatTime(playhead)} / {formatTime(audioInfo.duration)}
            </span>
            {labelCount > 0 && (
              <span style={styles.badge}>{labelCount} 个标记</span>
            )}
            <span style={styles.meta}>
              {audioInfo.levelCount} 层金字塔
            </span>
          </>
        )}
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(3)}`;
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: "0 12px",
    height: 48,
    background: "#FFFFFF",
    borderBottom: "1px solid #E2E8F0",
    flexShrink: 0,
    boxShadow: "0 1px 3px rgba(0,0,0,0.06)",
  },
  group: {
    display: "flex",
    alignItems: "center",
    gap: 3,
  },
  sep: {
    width: 1,
    height: 22,
    background: "#E2E8F0",
    margin: "0 6px",
  },
  btn: {
    background: "transparent",
    border: "1px solid #CBD5E1",
    color: "#475569",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 500,
    padding: "5px 11px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    transition: "all 0.15s",
  },
  btnPrimary: {
    background: "#2563EB",
    border: "1px solid #2563EB",
    color: "#FFFFFF",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    padding: "5px 13px",
    cursor: "pointer",
    whiteSpace: "nowrap",
  },
  btnIcon: {
    background: "transparent",
    border: "1px solid #CBD5E1",
    color: "#475569",
    borderRadius: 6,
    fontSize: 14,
    fontWeight: 600,
    padding: "3px 10px",
    cursor: "pointer",
    lineHeight: 1,
  },
  btnActive: {
    background: "#EFF6FF",
    borderColor: "#3B82F6",
    color: "#2563EB",
  },
  info: {
    display: "flex",
    alignItems: "center",
    gap: 10,
  },
  time: {
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 13,
    color: "#1E293B",
    letterSpacing: "-0.3px",
    fontWeight: 500,
  },
  badge: {
    fontSize: 11,
    fontWeight: 600,
    color: "#2563EB",
    background: "#EFF6FF",
    border: "1px solid #BFDBFE",
    borderRadius: 10,
    padding: "1px 8px",
  },
  meta: {
    fontSize: 11,
    color: "#94A3B8",
  },
  loading: {
    fontSize: 12,
    color: "#D97706",
    fontWeight: 500,
  },
  error: {
    fontSize: 12,
    color: "#DC2626",
    fontWeight: 500,
  },
};