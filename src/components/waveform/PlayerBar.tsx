import type { PlayState } from "@/hooks/useAudioPlayer";

interface PlayerBarProps {
  playState: PlayState;
  currentTime: number;
  duration: number;
  onPlay: () => void;
  onPause: () => void;
  onSeek: (sec: number) => void;
}

export function PlayerBar({
  playState,
  currentTime,
  duration,
  onPlay,
  onPause,
  onSeek,
}: PlayerBarProps) {
  if (playState === "idle") return null;

  const isPlaying = playState === "playing";
  const isLoading = playState === "loading";
  const progress = duration > 0 ? currentTime / duration : 0;

  const handleProgressClick = (e: React.MouseEvent<HTMLDivElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(ratio * duration);
  };

  return (
    <div style={styles.bar}>

      {/* 播放/暂停按钮 */}
      <button
        style={styles.playBtn}
        onClick={isPlaying ? onPause : onPlay}
        disabled={isLoading}
        title={isPlaying ? "暂停" : "播放"}
      >
        {isLoading ? "…" : isPlaying ? "⏸" : "▶"}
      </button>

      {/* 时间 */}
      <span style={styles.time}>{formatTime(currentTime)}</span>

      {/* 进度条 */}
      <div style={styles.trackWrap} onClick={handleProgressClick}>
        <div style={styles.track}>
          <div style={{ ...styles.fill, width: `${progress * 100}%` }} />
          {/* 拖动手柄 */}
          <div style={{ ...styles.thumb, left: `${progress * 100}%` }} />
        </div>
      </div>

      <span style={styles.time}>{formatTime(duration)}</span>
    </div>
  );
}

function formatTime(sec: number): string {
  if (!isFinite(sec)) return "0:00";
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s < 10 ? "0" : ""}${s}`;
}

const styles: Record<string, React.CSSProperties> = {
  bar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0 14px",
    height: 44,
    background: "#FFFFFF",
    borderTop: "1px solid #E2E8F0",
    flexShrink: 0,
  },
  playBtn: {
    width: 32,
    height: 32,
    borderRadius: "50%",
    background: "#2563EB",
    border: "none",
    color: "#fff",
    fontSize: 13,
    cursor: "pointer",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    flexShrink: 0,
  },
  time: {
    fontFamily: "'SF Mono', 'Fira Code', monospace",
    fontSize: 12,
    color: "#64748B",
    flexShrink: 0,
    minWidth: 36,
    textAlign: "center",
  },
  trackWrap: {
    flex: 1,
    padding: "10px 0",
    cursor: "pointer",
  },
  track: {
    position: "relative",
    height: 4,
    background: "#E2E8F0",
    borderRadius: 2,
  },
  fill: {
    position: "absolute",
    left: 0,
    top: 0,
    height: "100%",
    background: "#2563EB",
    borderRadius: 2,
    pointerEvents: "none",
  },
  thumb: {
    position: "absolute",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: 12,
    height: 12,
    borderRadius: "50%",
    background: "#2563EB",
    border: "2px solid #fff",
    boxShadow: "0 1px 3px rgba(0,0,0,0.2)",
    pointerEvents: "none",
  },
};