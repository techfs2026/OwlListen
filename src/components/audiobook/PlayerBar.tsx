import React, { useRef, useCallback } from "react";
import { C, FONT } from "@/styles";
import { PlayBtn } from "@/components/shared/Primitives";
import type { Speed } from "@/hooks/useAudiobook";
import { SPEEDS } from "@/hooks/useAudiobook";
import type { PlayState } from "@/hooks/useAudiobook";
import type { Chapter } from "@/utils/audiobookApi";

interface PlayerBarProps {
  playState: PlayState;
  currentChapter: Chapter | null;
  currentChapterIndex: number;
  totalChapters: number;
  currentTime: number;
  speed: Speed;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (sec: number) => void;
  onSpeedChange: (s: Speed) => void;
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function PlayerBar({
  playState, currentChapter, currentChapterIndex, totalChapters,
  currentTime, speed,
  onPlay, onPause, onPrev, onNext, onSeek, onSpeedChange,
}: PlayerBarProps) {
  const isPlaying = playState === "playing";
  const isReady = playState === "ready" || playState === "playing" || playState === "paused";
  const chDur = currentChapter ? currentChapter.endSec - currentChapter.startSec : 0;
  const progress = chDur > 0 ? currentTime / chDur : 0;

  // ── 拖拽 seek ──────────────────────────────────────────────────────────────
  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const seekFromEvent = useCallback((clientX: number) => {
    if (!isReady || chDur <= 0 || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
    onSeek(ratio * chDur);
  }, [isReady, chDur, onSeek]);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!isReady) return;
    isDragging.current = true;
    seekFromEvent(e.clientX);

    const onMove = (ev: MouseEvent) => {
      if (isDragging.current) seekFromEvent(ev.clientX);
    };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [isReady, seekFromEvent]);

  return (
    <div style={s.bar}>
      {/* 进度条 + 时间码合并一行 */}
      <div style={s.seekRow}>
        {/* 时间：已播放 */}
        <span style={s.timeCode}>
          {isReady ? fmtTime(currentTime) : "--:--"}
        </span>

        {/* 进度条 */}
        <div
          ref={trackRef}
          style={s.progressArea}
          onMouseDown={handleMouseDown}
        >
          <div style={s.progressTrack}>
            <div style={{ ...s.progressFill, width: `${progress * 100}%` }} />
            {isReady && (
              <div style={{ ...s.progressThumb, left: `${progress * 100}%` }} />
            )}
          </div>
        </div>

        {/* 时间：总时长 */}
        <span style={{ ...s.timeCode, color: C.ink3 }}>
          {isReady ? fmtTime(chDur) : "--:--"}
        </span>
      </div>

      {/* 控制行 */}
      <div style={s.controls}>
        {/* 左：空占位 */}
        <div style={s.leftZone} />

        {/* 中：播放控制 */}
        <div style={s.centerZone}>
          <button
            style={{ ...s.skipBtn, opacity: currentChapterIndex <= 0 ? 0.3 : 1 }}
            disabled={!isReady || currentChapterIndex <= 0}
            onClick={onPrev}
          >
            <SkipIcon direction="prev" />
          </button>

          <PlayBtn
            playing={isPlaying}
            disabled={!isReady}
            size={40}
            onClick={isPlaying ? onPause : onPlay}
          />

          <button
            style={{ ...s.skipBtn, opacity: currentChapterIndex >= totalChapters - 1 ? 0.3 : 1 }}
            disabled={!isReady || currentChapterIndex >= totalChapters - 1}
            onClick={onNext}
          >
            <SkipIcon direction="next" />
          </button>
        </div>

        {/* 右：速率 */}
        <div style={s.rightZone}>
          <div style={s.speeds}>
            {SPEEDS.map((s_) => (
              <button
                key={s_}
                style={{
                  ...s.speedBtn,
                  background: speed === s_ ? C.ink : "transparent",
                  color: speed === s_ ? "#fff" : C.ink3,
                  fontWeight: speed === s_ ? 600 : 400,
                }}
                onClick={() => onSpeedChange(s_)}
              >
                {s_}×
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function SkipIcon({ direction }: { direction: "prev" | "next" }) {
  return (
    <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
      {direction === "prev" ? (
        <>
          <rect x="3" y="4" width="2" height="12" rx="1" fill="currentColor" />
          <path d="M15 4L7 10L15 16V4Z" fill="currentColor" />
        </>
      ) : (
        <>
          <rect x="15" y="4" width="2" height="12" rx="1" fill="currentColor" />
          <path d="M5 4L13 10L5 16V4Z" fill="currentColor" />
        </>
      )}
    </svg>
  );
}

const s: Record<string, React.CSSProperties> = {
  bar: {
    background: C.paper,
    borderTop: `0.5px solid ${C.border}`,
    flexShrink: 0,
    userSelect: "none",
    paddingBottom: 8,
  },
  // 进度条 + 时间码同行
  seekRow: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "8px 16px 4px",
  },
  progressArea: {
    flex: 1,
    cursor: "pointer",
    height: 20,
    display: "flex",
    alignItems: "center",
  },
  progressTrack: {
    flex: 1,
    height: 3,
    background: C.paper2,
    position: "relative",
    cursor: "pointer",
    borderRadius: 2,
  },
  progressFill: {
    height: "100%",
    background: `linear-gradient(90deg, ${C.blue}, #60A5FA)`,
    pointerEvents: "none",
    borderRadius: 2,
  },
  progressThumb: {
    position: "absolute",
    top: "50%",
    transform: "translate(-50%, -50%)",
    width: 10,
    height: 10,
    borderRadius: "50%",
    background: C.blue,
    boxShadow: "0 0 0 2px white",
    pointerEvents: "none",
  },
  controls: {
    display: "flex",
    alignItems: "center",
    padding: "0 16px",
  },
  leftZone: {
    flex: 1,
  },
  centerZone: {
    display: "flex",
    alignItems: "center",
    gap: 14,
  },
  rightZone: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "flex-end",
  },
  skipBtn: {
    background: "none",
    border: "none",
    color: C.ink2,
    cursor: "pointer",
    padding: 4,
    display: "flex",
    alignItems: "center",
    borderRadius: 6,
    transition: "opacity 0.15s",
  },
  timeCode: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: C.ink2,
    letterSpacing: "-0.02em",
    flexShrink: 0,
    minWidth: 36,
  },
  speeds: {
    display: "flex",
    gap: 2,
    background: C.paper2,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 6,
    padding: 2,
  },
  speedBtn: {
    fontFamily: FONT.mono,
    fontSize: 11,
    border: "none",
    borderRadius: 4,
    padding: "3px 6px",
    cursor: "pointer",
    transition: "background 0.12s",
    whiteSpace: "nowrap" as const,
  },
};