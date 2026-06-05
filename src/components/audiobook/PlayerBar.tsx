import React, { useRef, useState, useCallback } from "react";
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
  autoAdvance: boolean;
  onPlay: () => void;
  onPause: () => void;
  onPrev: () => void;
  onNext: () => void;
  onSeek: (sec: number) => void;
  onSpeedChange: (s: Speed) => void;
  onToggleAutoAdvance: () => void;
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
  currentTime, speed, autoAdvance,
  onPlay, onPause, onPrev, onNext, onSeek, onSpeedChange, onToggleAutoAdvance,
}: PlayerBarProps) {
  const isPlaying = playState === "playing";
  const isReady = playState === "ready" || playState === "playing" || playState === "paused";
  const chDur = currentChapter ? currentChapter.endSec - currentChapter.startSec : 0;
  const progress = chDur > 0 ? currentTime / chDur : 0;

  const trackRef = useRef<HTMLDivElement>(null);
  const isDragging = useRef(false);

  const [tooltip, setTooltip] = useState<{ x: number; time: number } | null>(null);

  const getRatioFromClientX = useCallback((clientX: number) => {
    if (!trackRef.current) return 0;
    const rect = trackRef.current.getBoundingClientRect();
    return Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
  }, []);

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

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isReady || chDur <= 0 || !trackRef.current) return;
    const rect = trackRef.current.getBoundingClientRect();
    const ratio = getRatioFromClientX(e.clientX);
    // x 相对于进度条容器左边，夹到 [0, width] 防止溢出
    const x = Math.max(0, Math.min(e.clientX - rect.left, rect.width));
    setTooltip({ x, time: ratio * chDur });
  }, [isReady, chDur, getRatioFromClientX]);

  const handleMouseLeave = useCallback(() => {
    setTooltip(null);
  }, []);

  return (
    <div className="player-bar">
      <div className="player-bar__seek-row">
        <span className="player-bar__time">{isReady ? fmtTime(currentTime) : "--:--"}</span>

        <div className="player-bar__progress-area" ref={trackRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          style={{ position: "relative" }}
        >
          <div className="player-bar__progress-track">
            <div className="player-bar__progress-fill" style={{ width: `${progress * 100}%` }} />
            {isReady && (
              <div className="player-bar__progress-thumb" style={{ left: `${progress * 100}%` }} />
            )}
          </div>

          {tooltip !== null && (
            <div
              className="player-bar__tooltip"
              style={{
                position: "absolute",
                bottom: "calc(100% + 8px)",
                left: tooltip.x,
                transform: "translateX(-50%)",
                pointerEvents: "none",
              }}
            >
              {fmtTime(tooltip.time)}
            </div>
          )}
        </div>

        <span className="player-bar__time player-bar__time--muted">
          {isReady ? fmtTime(chDur) : "--:--"}
        </span>
      </div>

      <div className="player-bar__controls">
        <div className="player-bar__zone player-bar__zone--left">
          <button
            className={`player-bar__autoplay${autoAdvance ? " player-bar__autoplay--active" : ""}`}
            onClick={onToggleAutoAdvance}
            title={autoAdvance ? "自动续播下一章：开" : "自动续播下一章：关"}
          >
            <span className="player-bar__autoplay-dot" />
            连播
          </button>
        </div>

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