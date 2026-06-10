import React from "react";
import { Btn } from "@/components/shared/Primitives";
import type { AudioInfo, LoadingState } from "@/types/waveform";

interface AnnotateToolbarProps {
  audioInfo: AudioInfo | null;
  loadingState: LoadingState;
  labelCount: number;
  onBack: () => void;
  onShowHelp: () => void;
  onOpenAudio: () => void;
  onSaveLabels: () => void;
  onLoadLabels: () => void;
  onClearLabels: () => void;
  onExport: () => void;
}

export function AnnotateToolbar({
  audioInfo,
  loadingState,
  labelCount,
  onBack,
  onShowHelp,
  onOpenAudio,
  onSaveLabels,
  onLoadLabels,
  onClearLabels,
  onExport,
}: AnnotateToolbarProps) {
  const isReady = loadingState === "ready";

  return (
    <div style={s.shell}>
      {/* ── 单行：导航 · 文件操作 · 状态 · 导出 ── */}
      <div style={s.row}>
        <Btn variant="ghost" size="sm" onClick={onBack}>
          ← 返回
        </Btn>
        <span style={s.modeTag}>初次精听</span>
        <div style={s.rowSep} />

        <Btn variant="primary" onClick={onOpenAudio}>
          打开音频
        </Btn>
        <div style={s.rowSep} />
        <Btn variant="ghost" onClick={onLoadLabels} disabled={!isReady}>
          载入标记
        </Btn>
        <Btn variant="ghost" onClick={onSaveLabels} disabled={labelCount === 0}>
          保存标记
        </Btn>
        <Btn variant="ghost" onClick={onClearLabels} disabled={labelCount === 0}>
          清空标记
        </Btn>

        {loadingState === "decoding" && (
          <span style={s.decoding}>
            <span style={s.decodingDot} />
            解码中…
          </span>
        )}
        {loadingState === "error" && <span style={s.error}>加载失败</span>}
        {isReady && audioInfo && labelCount > 0 && <span style={s.badge}>{labelCount} 段</span>}

        <div style={{ flex: 1 }} />

        <Btn variant="dark" onClick={onExport} disabled={labelCount === 0}>
          ⬇ 导出数据包
        </Btn>
        <div style={s.rowSep} />
        <Btn
          variant="ghost"
          size="sm"
          onClick={onShowHelp}
          style={{ fontSize: 12 }}
          title="查看全部快捷键"
        >
          快捷键 <kbd className="kbd kbd--inline">H</kbd>
        </Btn>
      </div>
    </div>
  );
}

// ── 样式 ─────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    background: "var(--color-paper)",
    borderBottom: `0.5px solid var(--color-border)`,
    flexShrink: 0,
    boxShadow: "0 1px 0 rgba(26,39,68,0.04)",
  },
  row: {
    display: "flex",
    alignItems: "center",
    gap: 6,
    padding: "0 16px",
    height: 44,
  },
  rowSep: {
    width: 1,
    height: 18,
    background: "var(--color-border-2)",
    borderRadius: 1,
    flexShrink: 0,
    margin: "0 2px",
  },
  modeTag: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: "var(--color-brand)",
    padding: "2px 7px",
    background: "var(--color-brand-soft)",
    borderRadius: 4,
  },
  time: {
    fontFamily: "var(--font-mono)",
    fontSize: 13,
    color: "var(--color-ink-1)",
    letterSpacing: "-0.02em",
    minWidth: 138,
  },
  timeSep: { color: "var(--color-ink-3)", margin: "0 3px" },
  meta: { fontSize: 11, color: "var(--color-ink-3)" },
  badge: {
    fontFamily: "var(--font-mono)",
    fontSize: 10,
    fontWeight: 500,
    color: "var(--color-brand)",
    background: "var(--color-brand-soft)",
    border: `0.5px solid #5B7FEA44`,
    borderRadius: 10,
    padding: "2px 8px",
  },
  decoding: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 12,
    color: "#D97706",
    fontWeight: 500,
  },
  decodingDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#D97706",
    animation: "spin 1s linear infinite",
  },
  error: { fontSize: 12, color: "var(--color-danger)", fontWeight: 500 },
};
