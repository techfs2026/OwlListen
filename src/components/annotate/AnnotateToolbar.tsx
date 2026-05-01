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
  children,
  onClick,
  disabled,
  variant = "default",
  active,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  variant?: "default" | "primary" | "dark" | "outlined" | "loop";
  active?: boolean;
}) {
  const base: React.CSSProperties = {
    fontFamily: FONT.sans,
    fontSize: 13,
    fontWeight: 500,
    borderRadius: 7,
    padding: "7px 16px",
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
    // 回环按钮：激活时绿底白字
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

export function AnnotateToolbar({
  audioInfo,
  loadingState,
  labelCount,
  currentTime,
  playing,
  looping,
  onBack,
  onOpenAudio,
  onSaveLabels,
  onLoadLabels,
  onClearLabels,
  onPlay,
  onPause,
  onExport,
  onToggleLoop,
}: AnnotateToolbarProps) {
  const isReady = loadingState === "ready";

  return (
    <div style={s.bar}>
      {/* 返回 */}
      <TbBtn onClick={onBack} variant="outlined" disabled={false}>← 返回</TbBtn>
      <TbSep />

      {/* 模式标识 */}
      <span style={s.modeTag}>标注模式</span>
      <TbSep />

      {/* 文件操作 */}
      <TbBtn variant="primary" onClick={onOpenAudio}>打开音频</TbBtn>
      <TbBtn variant="outlined" onClick={onLoadLabels} disabled={!isReady}>载入标记</TbBtn>
      <TbBtn variant="outlined" onClick={onSaveLabels} disabled={labelCount === 0}>保存标记</TbBtn>
      <TbBtn variant="outlined" onClick={onClearLabels} disabled={labelCount === 0}>清空</TbBtn>
      <TbSep />

      {/* 播放控制 */}
      <PlayBtn
        playing={playing}
        disabled={!isReady}
        size={30}
        onClick={playing ? onPause : onPlay}
      />
      <kbd style={s.kbd}>P</kbd>

      {/* 回环播放按钮 */}
      <TbBtn
        variant="loop"
        active={looping}
        disabled={!isReady || labelCount === 0}
        onClick={onToggleLoop}
      >
        ↺ 回环
      </TbBtn>
      <kbd style={s.kbd}>L</kbd>

      <span style={s.time}>
        {formatTime(currentTime)}
        <span style={s.timeSep}>/</span>
        {formatTime(audioInfo?.duration ?? 0)}
      </span>

      {/* 状态指示 */}
      {loadingState === "decoding" && (
        <>
          <TbSep />
          <span style={s.decoding}>
            <span style={s.decodingDot} /> 解码中…
          </span>
        </>
      )}
      {loadingState === "error" && (
        <>
          <TbSep />
          <span style={s.error}>加载失败</span>
        </>
      )}
      {isReady && audioInfo && (
        <>
          <TbSep />
          <span style={s.meta}>{audioInfo.levelCount} 层金字塔</span>
          {labelCount > 0 && <span style={s.badge}>{labelCount} 段</span>}
        </>
      )}

      <div style={{ flex: 1 }} />

      {/* 快捷键提示 */}
      <span style={s.hint}>
        <HintIcon />
        <span>滚轮缩放 · Meta+滚轮平移</span>
        <TbSep />
        <span style={s.shortcutGroup}>
          <kbd style={s.kbdSm}>[</kbd><span>入</span>
          <kbd style={s.kbdSm}>]</kbd><span>出</span>
          <kbd style={s.kbdSm}>N</kbd><span>静音</span>
        </span>
      </span>
      <TbSep />

      {/* 导出 */}
      <TbBtn variant="dark" onClick={onExport} disabled={labelCount === 0}>
        ⬇ 导出数据包
      </TbBtn>
    </div>
  );
}

function HintIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 14 14" fill="none" style={{ flexShrink: 0 }}>
      <circle cx="7" cy="7" r="5.5" stroke="currentColor" strokeWidth="1"/>
      <path d="M7 4.5v3M7 9h0" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round"/>
    </svg>
  );
}

const s: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    padding: "0 20px",
    height: 60,
    background: C.paper,
    borderBottom: `0.5px solid ${C.border}`,
    flexShrink: 0,
    boxShadow: "0 1px 0 rgba(26,39,68,0.04)",
  },
  modeTag: {
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: "0.10em",
    textTransform: "uppercase" as const,
    color: C.blue,
    padding: "3px 9px",
    background: C.blueLt,
    borderRadius: 4,
  },
  kbd: {
    fontFamily: FONT.mono,
    fontSize: 10,
    color: C.ink3,
    background: C.paper2,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 3,
    padding: "1px 5px",
    lineHeight: 1.2,
  },
  kbdSm: {
    fontFamily: FONT.mono,
    fontSize: 9,
    color: C.ink3,
    background: C.paper2,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 3,
    padding: "1px 4px",
    lineHeight: 1.2,
  },
  time: {
    fontFamily: FONT.mono,
    fontSize: 14,
    color: C.ink,
    letterSpacing: "-0.02em",
    minWidth: 145,
  },
  timeSep: { color: C.ink3, margin: "0 4px" },
  meta: { fontSize: 12, color: C.ink3 },
  badge: {
    fontFamily: FONT.mono,
    fontSize: 11,
    fontWeight: 500,
    color: C.blue,
    background: C.blueLt,
    border: `0.5px solid ${C.blueMid}44`,
    borderRadius: 10,
    padding: "2px 10px",
  },
  decoding: {
    display: "flex", alignItems: "center", gap: 5,
    fontSize: 13, color: "#D97706", fontWeight: 500,
  },
  decodingDot: {
    width: 7, height: 7, borderRadius: "50%",
    background: "#D97706",
    animation: "spin 1s linear infinite",
  },
  error: { fontSize: 13, color: C.red, fontWeight: 500 },
  hint: {
    display: "flex", alignItems: "center", gap: 5,
    fontSize: 12, color: C.ink3,
    fontFamily: FONT.mono,
  },
  shortcutGroup: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontSize: 11,
    color: C.ink3,
  },
};