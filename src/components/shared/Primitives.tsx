import React from "react";
import { C, FONT, SHADOW } from "@/styles";

// ── 按钮 ──────────────────────────────────────────────────────────────────────

type BtnVariant = "default" | "primary" | "dark" | "ghost" | "danger" | "success";

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: "sm" | "md";
}

const BTN_STYLES: Record<BtnVariant, React.CSSProperties> = {
  default: { background: C.paper, color: C.ink2,  border: `0.5px solid ${C.border2}` },
  primary: { background: C.blue,  color: "#fff",   border: `0.5px solid ${C.blue}` },
  dark:    { background: C.ink,   color: "#fff",   border: `0.5px solid ${C.ink}` },
  ghost:   { background: "transparent", color: C.ink3, border: `0.5px solid ${C.border2}` },
  danger:  { background: C.redLt, color: C.red,    border: `0.5px solid rgba(192,57,43,0.22)` },
  success: { background: C.greenLt, color: C.green, border: `0.5px solid rgba(22,101,52,0.22)` },
};

export function Btn({ variant = "default", size = "md", style, children, ...rest }: BtnProps) {
  const pad = size === "sm" ? "5px 12px" : "7px 16px";
  return (
    <button
      style={{
        fontFamily: FONT.sans,
        fontSize: size === "sm" ? 12 : 13,
        fontWeight: 500,
        borderRadius: 7,
        padding: pad,
        cursor: "pointer",
        whiteSpace: "nowrap",
        lineHeight: 1.4,
        transition: "opacity 0.12s",
        ...BTN_STYLES[variant],
        ...style,
      }}
      {...rest}
    >
      {children}
    </button>
  );
}

// ── 圆形播放按钮 ──────────────────────────────────────────────────────────────

interface PlayBtnProps {
  playing: boolean;
  disabled?: boolean;
  size?: number;
  onClick: () => void;
}

export function PlayBtn({ playing, disabled, size = 28, onClick }: PlayBtnProps) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      style={{
        width: size, height: size,
        borderRadius: "50%",
        background: disabled ? C.ink3 : C.blue,
        border: "none",
        display: "flex", alignItems: "center", justifyContent: "center",
        flexShrink: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background 0.12s",
      }}
    >
      {playing ? (
        // 暂停图标
        <svg width={size * 0.36} height={size * 0.36} viewBox="0 0 10 10">
          <rect x="1" y="0" width="3" height="10" fill="#fff" rx="1"/>
          <rect x="6" y="0" width="3" height="10" fill="#fff" rx="1"/>
        </svg>
      ) : (
        // 播放三角
        <svg width={size * 0.32} height={size * 0.36} viewBox="0 0 8 10" style={{ marginLeft: 2 }}>
          <polygon points="0,0 8,5 0,10" fill="#fff"/>
        </svg>
      )}
    </button>
  );
}

// ── 分隔线 ────────────────────────────────────────────────────────────────────

export function TbSep() {
  return <div style={{ width: 0.5, height: 20, background: C.border2, margin: "0 5px", flexShrink: 0 }} />;
}

// ── 徽章 ──────────────────────────────────────────────────────────────────────

interface BadgeProps { children: React.ReactNode; color?: "blue" | "green" | "red" | "amber" }
const BADGE_COLORS = {
  blue:  { bg: C.blueLt,  fg: C.blue },
  green: { bg: C.greenLt, fg: C.green },
  red:   { bg: C.redLt,   fg: C.red },
  amber: { bg: C.amberLt, fg: C.amber },
};
export function Badge({ children, color = "blue" }: BadgeProps) {
  const { bg, fg } = BADGE_COLORS[color];
  return (
    <span style={{
      display: "inline-block",
      fontFamily: FONT.mono,
      fontSize: 10,
      letterSpacing: "0.10em",
      textTransform: "uppercase",
      padding: "3px 10px",
      borderRadius: 4,
      background: bg,
      color: fg,
    }}>
      {children}
    </span>
  );
}

// ── 进度条播放器（迷你） ──────────────────────────────────────────────────────

interface MiniPlayerProps {
  playing: boolean;
  currentTime: number;
  duration: number;
  disabled?: boolean;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (sec: number) => void;
  onReplay?: () => void;
}

function fmt(sec: number) {
  if (!isFinite(sec)) return "0.0s";
  return sec.toFixed(1) + "s";
}

export function MiniPlayer({ playing, currentTime, duration, disabled, onPlay, onPause, onSeek, onReplay }: MiniPlayerProps) {
  const pct = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div style={{
      display: "flex", alignItems: "center", gap: 10,
      background: C.paper2, border: `0.5px solid ${C.border}`,
      borderRadius: 10, padding: "8px 12px",
    }}>
      <PlayBtn playing={playing} disabled={disabled} size={28}
        onClick={playing ? onPause : onPlay} />

      <div style={{ flex: 1, padding: "6px 0", cursor: "pointer" }} onClick={handleTrackClick}>
        <div style={{ position: "relative", height: 3, background: C.border2, borderRadius: 2 }}>
          <div style={{
            position: "absolute", left: 0, top: 0, height: "100%",
            width: `${pct * 100}%`, background: C.blue, borderRadius: 2,
          }} />
          <div style={{
            position: "absolute", top: "50%", left: `${pct * 100}%`,
            transform: "translate(-50%, -50%)",
            width: 10, height: 10, borderRadius: "50%",
            background: C.blue, border: `1.5px solid ${C.paper}`,
          }} />
        </div>
      </div>

      <span style={{ fontFamily: FONT.mono, fontSize: 12, color: C.ink3, whiteSpace: "nowrap" }}>
        {fmt(currentTime)} / {fmt(duration)}
      </span>

      {onReplay && (
        <Btn variant="ghost" size="sm" onClick={onReplay} style={{ fontSize: 11 }}>
          ↺ 重播
        </Btn>
      )}
    </div>
  );
}

// ── 弹出层（Export Progress） ─────────────────────────────────────────────────

interface OverlayProps { children: React.ReactNode }
export function Overlay({ children }: OverlayProps) {
  return (
    <div style={{
      position: "fixed", inset: 0,
      background: "rgba(15,23,42,0.4)",
      backdropFilter: "blur(3px)",
      display: "flex", alignItems: "center", justifyContent: "center",
      zIndex: 200,
    }}>
      {children}
    </div>
  );
}

export function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{
      background: C.paper,
      border: `0.5px solid ${C.border2}`,
      borderRadius: 14,
      boxShadow: SHADOW.md,
      ...style,
    }}>
      {children}
    </div>
  );
}