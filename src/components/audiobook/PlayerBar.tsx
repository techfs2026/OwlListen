import React, { useRef, useCallback } from "react";
import { PlayBtn } from "@/components/shared/Primitives";
import { SPEEDS, type PlayState, type Speed } from "@/hooks/useAudiobook";
import type { Chapter } from "@/utils/audiobookApi";
import { SkipIcon } from "./icons";
import "./PlayerBar.scss";

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
    const onMove = (ev: MouseEvent) => { if (isDragging.current) seekFromEvent(ev.clientX); };
    const onUp = () => {
      isDragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, [isReady, seekFromEvent]);

  return (
    <div className="player-bar">
      <div className="player-bar__seek-row">
        <span className="player-bar__time">{isReady ? fmtTime(currentTime) : "--:--"}</span>

        <div className="player-bar__progress-area" ref={trackRef} onMouseDown={handleMouseDown}>
          <div className="player-bar__progress-track">
            <div className="player-bar__progress-fill" style={{ width: `${progress * 100}%` }} />
            {isReady && (
              <div className="player-bar__progress-thumb" style={{ left: `${progress * 100}%` }} />
            )}
          </div>
        </div>

        <span className="player-bar__time player-bar__time--muted">
          {isReady ? fmtTime(chDur) : "--:--"}
        </span>
      </div>

      <div className="player-bar__controls">
        <div className="player-bar__zone" />

        <div className="player-bar__zone player-bar__zone--center">
          <button
            className="btn btn--icon player-bar__skip"
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
            className="btn btn--icon player-bar__skip"
            disabled={!isReady || currentChapterIndex >= totalChapters - 1}
            onClick={onNext}
          >
            <SkipIcon direction="next" />
          </button>
        </div>

        <div className="player-bar__zone player-bar__zone--right">
          <div className="player-bar__speeds">
            {SPEEDS.map((s_) => (
              <button
                key={s_}
                className={`player-bar__speed${speed === s_ ? " player-bar__speed--active" : ""}`}
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