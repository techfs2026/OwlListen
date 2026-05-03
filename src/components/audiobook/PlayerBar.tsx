import React from "react";
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
  onOpenBook: () => void;
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
  onPlay, onPause, onPrev, onNext, onSeek, onSpeedChange, onOpenBook,
}: PlayerBarProps) {
  const isPlaying = playState === "playing";
  const isReady = playState === "ready" || playState === "playing" || playState === "paused";
  const chDur = currentChapter ? currentChapter.endSec - currentChapter.startSec : 0;
  const progress = chDur > 0 ? currentTime / chDur : 0;

  const handleSeekClick = (e: React.MouseEvent<HTMLDivElement>) => {
    if (!isReady || chDur <= 0) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    onSeek(Math.max(0, ratio * chDur));
  };

  return (
    <div style={s.bar}>
      {/* 章节进度条（可点击）*/}
      <div style={s.progressArea} onClick={handleSeekClick}>
        <div style={s.progressTrack}>
          <div style={{ ...s.progressFill, width: `${progress * 100}%` }} />
          {isReady && (
            <div style={{ ...s.progressThumb, left: `${progress * 100}%` }} />
          )}
        </div>
      </div>

      {/* 控制行 */}
      <div style={s.controls}>
        {/* 左：打开书 */}
        <div style={s.leftZone}>
          <button style={s.openBtn} onClick={onOpenBook}>打开有声书</button>
        </div>

        {/* 中：播放控制 */}
        <div style={s.centerZone}>
          {/* 上一章 */}
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

          {/* 下一章 */}
          <button
            style={{ ...s.skipBtn, opacity: currentChapterIndex >= totalChapters - 1 ? 0.3 : 1 }}
            disabled={!isReady || currentChapterIndex >= totalChapters - 1}
            onClick={onNext}
          >
            <SkipIcon direction="next" />
          </button>
        </div>

        {/* 右：时间 + 速率 */}
        <div style={s.rightZone}>
          {isReady && (
            <span style={s.timeCode}>
              {fmtTime(currentTime)}
              <span style={s.timeSep}>/</span>
              {fmtTime(chDur)}
            </span>
          )}
          {/* 速率选择 */}
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

      {/* 章节名 */}
      {currentChapter && (
        <div style={s.chapterName}>
          <span style={s.chapterIdx}>第 {currentChapterIndex + 1} 章</span>
          <span style={s.chapterTitle}>{currentChapter.title}</span>
        </div>
      )}
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
  },
  progressArea: {
    padding: "0 0 0",
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
  },
  progressFill: {
    height: "100%",
    background: `linear-gradient(90deg, ${C.blue}, #60A5FA)`,
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
  },
  controls: {
    display: "flex",
    alignItems: "center",
    padding: "4px 20px 6px",
    gap: 0,
  },
  leftZone: {
    flex: 1,
    display: "flex",
    alignItems: "center",
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
    gap: 12,
  },
  openBtn: {
    fontFamily: FONT.sans,
    fontSize: 12,
    fontWeight: 500,
    background: C.blue,
    color: "#fff",
    border: "none",
    borderRadius: 6,
    padding: "5px 13px",
    cursor: "pointer",
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
    fontSize: 12,
    color: C.ink2,
    letterSpacing: "-0.02em",
  },
  timeSep: { color: C.ink3, margin: "0 3px" },
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
  chapterName: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "0 20px 10px",
  },
  chapterIdx: {
    fontFamily: FONT.mono,
    fontSize: 10,
    color: C.blue,
    background: C.blueLt,
    padding: "1px 7px",
    borderRadius: 4,
    flexShrink: 0,
  },
  chapterTitle: {
    fontSize: 12,
    color: C.ink3,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
};