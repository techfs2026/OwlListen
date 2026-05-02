import React from "react";
import { C, FONT } from "@/styles";
import { PlayBtn, TbSep } from "@/components/shared/Primitives";
import type { AudioInfo, LoadingState } from "@/types/waveform";

interface AnnotateToolbarProps {
  audioInfo: AudioInfo | null;
  loadingState: LoadingState;
  labelCount: number;
  currentTime: number;
  playing: boolean;
  looping: boolean;
  onBack: () => void;
  onOpenAudio: () => void;
  onSaveLabels: () => void;
  onLoadLabels: () => void;
  onClearLabels: () => void;
  onPlay: () => void;
  onPause: () => void;
  onExport: () => void;
  onToggleLoop: () => void;
}

function formatTime(sec: number): string {
  if (!isFinite(sec)) return "0:00.000";
  const m = Math.floor(sec / 60);
  const s = sec - m * 60;
  return `${m}:${s < 10 ? "0" : ""}${s.toFixed(3)}`;
}

function TbBtn({
  children, onClick, disabled, variant = "default", active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "dark" | "outlined" | "loop";
  active?: boolean;
}) {
  const base: React.CSSProperties = {
    fontFamily: FONT.sans,
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    padding: "5px 13px",
    cursor: disabled ? "not-allowed" : "pointer",
    border: "none",
    whiteSpace: "nowrap" as const,
    opacity: disabled ? 0.38 : 1,
    lineHeight: 1.4,
    transition: "background 0.12s, opacity 0.12s",
  };
  const variants: Record<string, React.CSSProperties> = {
    default:  { background: C.paper2, color: C.ink2, border: `1px solid ${C.border2}` },
    primary:  { background: C.blue,   color: "#fff" },
    dark:     { background: C.ink,    color: "#fff" },
    outlined: { background: C.paper,  color: C.ink,  border: `1px solid ${C.border2}`, fontWeight: 400 },
    loop: active
      ? { background: "#16A34A", color: "#fff", border: "none" }
      : { background: C.paper, color: C.ink2, border: `1px solid ${C.border2}` },
  };
  return (
    <button style={{ ...base, ...variants[variant] }} onClick={onClick} disabled={disabled}>
      {children}
    </button>
  );
}

function Kbd({ children, sm }: { children: React.ReactNode; sm?: boolean }) {
  return (
    <kbd style={{
      fontFamily: FONT.mono,
      fontSize: sm ? 9 : 10,
      color: C.ink3,
      background: C.paper2,
      border: `0.5px solid ${C.border2}`,
      borderRadius: 3,
      padding: sm ? "1px 3px" : "1px 5px",
      lineHeight: 1.2,
    }}>
      {children}
    </kbd>
  );
}

function HintIcon() {
  return (
    <svg width="11" height="11" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0, opacity: 0.5 }}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1"/>
      <path d="M7 4.5v3M7 9h0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

export function AnnotateToolbar({
  audioInfo, loadingState, labelCount, currentTime,
  playing, looping,
  onBack, onOpenAudio, onSaveLabels, onLoadLabels, onClearLabels,
  onPlay, onPause, onExport, onToggleLoop,
}: AnnotateToolbarProps) {
  const isReady = loadingState === "ready";

  return (
    <div style={s.shell}>

      {/* ── 行一：导航 · 播放 · 时间 · 状态 ── */}
      <div style={s.row}>

        <TbBtn onClick={onBack} variant="outlined">← 返回</TbBtn>
        <span style={s.modeTag}>标注</span>
        <div style={s.rowSep} />

        <PlayBtn
          playing={playing}
          disabled={!isReady}
          size={28}
          onClick={playing ? onPause : onPlay}
        />
        <Kbd>P</Kbd>

        <TbBtn
          variant="loop"
          active={looping}
          disabled={!isReady || labelCount === 0}
          onClick={onToggleLoop}
        >
          ↺ 回环
        </TbBtn>
        <Kbd>L</Kbd>

        <div style={s.rowSep} />

        <span style={s.time}>
          {formatTime(currentTime)}
          <span style={s.timeSep}>/</span>
          {formatTime(audioInfo?.duration ?? 0)}
        </span>

        {loadingState === "decoding" && (
          <span style={s.decoding}><span style={s.decodingDot} />解码中…</span>
        )}
        {loadingState === "error" && (
          <span style={s.error}>加载失败</span>
        )}
        {isReady && audioInfo && (
          <>
            <span style={s.meta}>{audioInfo.levelCount} 层金字塔</span>
            {labelCount > 0 && <span style={s.badge}>{labelCount} 段</span>}
          </>
        )}

        <div style={{ flex: 1 }} />

        <span style={s.hint}>
          <HintIcon />
          滚轮缩放 · Meta 平移
          <span style={s.hintDot}>·</span>
          <Kbd sm>←→</Kbd>切段
          <Kbd sm>N</Kbd>跳静音
        </span>
      </div>

      <div style={s.divider} />

      {/* ── 行二：文件操作 · 导出 ── */}
      <div style={s.row}>
        <TbBtn variant="primary" onClick={onOpenAudio}>打开音频</TbBtn>
        <div style={s.rowSep} />
        <TbBtn variant="outlined" onClick={onLoadLabels}  disabled={!isReady}>载入标记</TbBtn>
        <TbBtn variant="outlined" onClick={onSaveLabels}  disabled={labelCount === 0}>保存标记</TbBtn>
        <TbBtn variant="outlined" onClick={onClearLabels} disabled={labelCount === 0}>清空标记</TbBtn>
        <div style={{ flex: 1 }} />
        <TbBtn variant="dark" onClick={onExport} disabled={labelCount === 0}>⬇ 导出数据包</TbBtn>
      </div>

    </div>
  );
}

// ── 样式 ─────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  shell: {
    display: "flex",
    flexDirection: "column",
    background: C.paper,
    borderBottom: `0.5px solid ${C.border}`,
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
  divider: {
    height: "0.5px",
    background: C.border,
    margin: "0 16px",
    opacity: 0.5,
  },
  rowSep: {
    width: 1,
    height: 18,
    background: C.border2,
    borderRadius: 1,
    flexShrink: 0,
    margin: "0 2px",
  },
  modeTag: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: C.blue,
    padding: "2px 7px",
    background: C.blueLt,
    borderRadius: 4,
  },
  time: {
    fontFamily: FONT.mono,
    fontSize: 13,
    color: C.ink,
    letterSpacing: "-0.02em",
    minWidth: 138,
  },
  timeSep: { color: C.ink3, margin: "0 3px" },
  meta: { fontSize: 11, color: C.ink3 },
  badge: {
    fontFamily: FONT.mono,
    fontSize: 10,
    fontWeight: 500,
    color: C.blue,
    background: C.blueLt,
    border: `0.5px solid ${C.blueMid}44`,
    borderRadius: 10,
    padding: "2px 8px",
  },
  decoding: {
    display: "flex", alignItems: "center", gap: 4,
    fontSize: 12, color: "#D97706", fontWeight: 500,
  },
  decodingDot: {
    width: 6, height: 6, borderRadius: "50%",
    background: "#D97706",
    animation: "spin 1s linear infinite",
  },
  error: { fontSize: 12, color: C.red, fontWeight: 500 },
  hint: {
    display: "flex", alignItems: "center", gap: 4,
    fontSize: 11, color: C.ink3,
    fontFamily: FONT.mono,
  },
  hintDot: { margin: "0 2px", color: C.border2 },
};