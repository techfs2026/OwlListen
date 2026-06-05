import React from "react";

// ── 按钮 ──────────────────────────────────────────────────────────────────────

type BtnVariant = "default" | "primary" | "dark" | "ghost" | "text" | "danger" | "success";
type BtnSize = "sm" | "md" | "lg";

interface BtnProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: BtnVariant;
  size?: BtnSize;
}

export function Btn({ variant = "default", size = "md", className, children, ...rest }: BtnProps) {
  const cls = ["btn", `btn--${variant}`, size !== "md" ? `btn--${size}` : "", className ?? ""]
    .filter(Boolean)
    .join(" ");

  return (
    <button className={cls} {...rest}>
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
        width: size,
        height: size,
        borderRadius: "50%",
        background: disabled ? "var(--color-ink-3)" : "var(--color-brand)",
        border: "none",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
        cursor: disabled ? "not-allowed" : "pointer",
        transition: "background var(--duration-fast) var(--ease-out)",
      }}
    >
      {playing ? (
        <svg width={size * 0.36} height={size * 0.36} viewBox="0 0 10 10">
          <rect x="1" y="0" width="3" height="10" fill="#fff" rx="1" />
          <rect x="6" y="0" width="3" height="10" fill="#fff" rx="1" />
        </svg>
      ) : (
        <svg width={size * 0.32} height={size * 0.36} viewBox="0 0 8 10" style={{ marginLeft: 2 }}>
          <polygon points="0,0 8,5 0,10" fill="#fff" />
        </svg>
      )}
    </button>
  );
}

// ── 工具栏分隔线 ──────────────────────────────────────────────────────────────

export function TbSep() {
  return (
    <div
      style={{
        width: 0.5,
        height: 20,
        background: "var(--color-border-2)",
        margin: "0 5px",
        flexShrink: 0,
      }}
    />
  );
}

// ── 徽章 ──────────────────────────────────────────────────────────────────────

type BadgeColor = "blue" | "green" | "red" | "amber";

const BADGE_CSS: Record<BadgeColor, { bg: string; fg: string }> = {
  blue: { bg: "var(--color-brand-soft)", fg: "var(--color-brand)" },
  green: { bg: "var(--color-success-soft)", fg: "var(--color-success)" },
  red: { bg: "var(--color-danger-soft)", fg: "var(--color-danger)" },
  amber: { bg: "var(--color-warning-soft)", fg: "var(--color-warning)" },
};

interface BadgeProps {
  children: React.ReactNode;
  color?: BadgeColor;
}

export function Badge({ children, color = "blue" }: BadgeProps) {
  const { bg, fg } = BADGE_CSS[color];
  return (
    <span
      style={{
        display: "inline-block",
        fontFamily: "var(--font-mono)",
        fontSize: "var(--font-size-xs)",
        letterSpacing: "0.10em",
        textTransform: "uppercase",
        padding: "3px 10px",
        borderRadius: "var(--radius-sm)",
        background: bg,
        color: fg,
      }}
    >
      {children}
    </span>
  );
}

// ── 进度条播放器（迷你）──────────────────────────────────────────────────────

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

export function MiniPlayer({
  playing,
  currentTime,
  duration,
  disabled,
  onPlay,
  onPause,
  onSeek,
  onReplay,
}: MiniPlayerProps) {
  const pct = duration > 0 ? Math.min(currentTime / duration, 1) : 0;

  const handleTrackClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    onSeek(((e.clientX - rect.left) / rect.width) * duration);
  };

  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        background: "var(--color-paper-2)",
        border: "0.5px solid var(--color-border)",
        borderRadius: "var(--radius-lg)",
        padding: "8px 12px",
      }}
    >
      <PlayBtn
        playing={playing}
        disabled={disabled}
        size={28}
        onClick={playing ? onPause : onPlay}
      />

      <div style={{ flex: 1, padding: "6px 0", cursor: "pointer" }} onClick={handleTrackClick}>
        <div
          style={{
            position: "relative",
            height: 3,
            background: "var(--color-border-2)",
            borderRadius: 2,
          }}
        >
          <div
            style={{
              position: "absolute",
              left: 0,
              top: 0,
              height: "100%",
              width: `${pct * 100}%`,
              background: "var(--color-brand)",
              borderRadius: 2,
            }}
          />
          <div
            style={{
              position: "absolute",
              top: "50%",
              left: `${pct * 100}%`,
              transform: "translate(-50%, -50%)",
              width: 10,
              height: 10,
              borderRadius: "50%",
              background: "var(--color-brand)",
              border: "1.5px solid var(--color-paper)",
            }}
          />
        </div>
      </div>

      <span
        style={{
          fontFamily: "var(--font-mono)",
          fontSize: "var(--font-size-sm)",
          color: "var(--color-ink-3)",
          whiteSpace: "nowrap",
        }}
      >
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

// ── 弹出层 ────────────────────────────────────────────────────────────────────

interface OverlayProps {
  children: React.ReactNode;
}

export function Overlay({ children }: OverlayProps) {
  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        background: "rgba(15, 23, 42, 0.4)",
        backdropFilter: "blur(3px)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        zIndex: 200,
      }}
    >
      {children}
    </div>
  );
}

// ── 卡片 ──────────────────────────────────────────────────────────────────────

export function Card({
  children,
  style,
}: {
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div
      style={{
        background: "var(--color-paper)",
        border: "0.5px solid var(--color-border-2)",
        borderRadius: "var(--radius-lg)",
        boxShadow: "var(--shadow-md)",
        ...style,
      }}
    >
      {children}
    </div>
  );
}
