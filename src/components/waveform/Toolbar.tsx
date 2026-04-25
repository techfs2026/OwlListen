import type { AudioInfo, LoadingState } from "@/types/waveform";

interface ToolbarProps {
  audioInfo: AudioInfo | null;
  loadingState: LoadingState;
  labelCount: number;
  playhead: number;
  onOpenAudio: () => void;
  onSaveLabels: () => void;
  onLoadLabels: () => void;
  onClearLabels: () => void;
  onExportPackage: () => void;
  onZoomIn: () => void;
  onZoomOut: () => void;
  onZoomReset: () => void;
}

export function Toolbar({
  audioInfo,
  loadingState,
  labelCount,
  playhead,
  onOpenAudio,
  onSaveLabels,
  onLoadLabels,
  onClearLabels,
  onExportPackage,
  onZoomIn,
  onZoomOut,
  onZoomReset,
}: ToolbarProps) {
  const isReady = loadingState === "ready";

  return (
    <div style={styles.bar}>
      {/* 左侧：文件操作 */}
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

      {/* 缩放 */}
      <div style={styles.group}>
        <div style={styles.sep} />
        <button style={styles.btnIcon} onClick={onZoomIn}  disabled={!isReady} title="放大 (Ctrl+滚轮)">+</button>
        <button style={styles.btnIcon} onClick={onZoomOut} disabled={!isReady} title="缩小">−</button>
        <button style={styles.btn}     onClick={onZoomReset} disabled={!isReady}>全览</button>
      </div>

      {/* 弹簧 */}
      <div style={{ flex: 1 }} />

      {/* 中间：状态信息 */}
      <div style={styles.info}>
        {loadingState === "decoding" && (
          <span style={styles.loading}>
            <span style={styles.dot} />
            解码中…
          </span>
        )}
        {loadingState === "error" && (
          <span style={styles.error}>加载失败</span>
        )}
        {isReady && audioInfo && (
          <>
            <span style={styles.time}>
              {formatTime(playhead)}
              <span style={styles.timeSep}>/</span>
              {formatTime(audioInfo.duration)}
            </span>
            {labelCount > 0 && (
              <span style={styles.badge}>{labelCount} 段</span>
            )}
            <span style={styles.meta}>{audioInfo.levelCount} 层金字塔</span>
          </>
        )}
      </div>

      {/* 右侧：导出 */}
      <div style={styles.group}>
        <div style={styles.sep} />
        <button
          style={styles.btnExport}
          onClick={onExportPackage}
          disabled={labelCount === 0}
          title="切割音频 + Whisper 转写 + 打包 ZIP"
        >
          ⬇ 导出数据包
        </button>
      </div>
    </div>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec)) return "0:00.000";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(3)}`;
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 2,
    padding: "0 14px",
    height: 48,
    background: "#FFFFFF",
    borderBottom: "1px solid #E2E8F0",
    flexShrink: 0,
    boxShadow: "0 1px 4px rgba(0,0,0,0.06)",
  },
  group: {
    display: "flex",
    alignItems: "center",
    gap: 4,
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
  },
  btnPrimary: {
    background: "#2563EB",
    border: "1px solid #2563EB",
    color: "#FFFFFF",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    padding: "5px 14px",
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
  btnExport: {
    background: "#0F172A",
    border: "1px solid #0F172A",
    color: "#FFFFFF",
    borderRadius: 6,
    fontSize: 12,
    fontWeight: 600,
    padding: "5px 14px",
    cursor: "pointer",
    whiteSpace: "nowrap",
    letterSpacing: "0.2px",
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
    fontWeight: 500,
    letterSpacing: "-0.3px",
  },
  timeSep: {
    color: "#CBD5E1",
    margin: "0 3px",
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
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "#D97706",
    fontWeight: 500,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#D97706",
    animation: "spin 1s linear infinite",
  },
  error: {
    fontSize: 12,
    color: "#DC2626",
    fontWeight: 500,
  },
};