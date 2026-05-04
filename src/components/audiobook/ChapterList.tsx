import { useEffect, useRef } from "react";
import type { Chapter } from "@/utils/audiobookApi";
import { PlayingBars } from "./icons";
import "./ChapterList.scss";

interface ChapterListProps {
  chapters: Chapter[];
  currentIndex: number;
  currentTime: number;
  onSelect: (index: number) => void;
}

function fmtTime(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function ChapterList({ chapters, currentIndex, currentTime, onSelect }: ChapterListProps) {
  const activeRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIndex]);

  return (
    <div className="chapter-list">
      <div className="chapter-list__header">
        <span className="chapter-list__label">章节</span>
        <span className="chapter-list__count">{chapters.length} 章</span>
      </div>

      <div className="chapter-list__items">
        {chapters.map((ch, i) => {
          const isActive = i === currentIndex;
          const chDur = ch.endSec - ch.startSec;
          const progressRatio = isActive && chDur > 0 ? Math.min(1, currentTime / chDur) : 0;

          return (
            <div
              key={ch.index}
              ref={isActive ? activeRef : undefined}
              className={`chapter-item${isActive ? " chapter-item--active" : ""}`}
              onClick={() => onSelect(i)}
            >
              <div className="chapter-item__idx">
                {isActive ? <PlayingBars /> : String(i + 1).padStart(2, "0")}
              </div>

              <div className="chapter-item__info">
                <div className="chapter-item__title">{ch.title}</div>
                <div className="chapter-item__meta">
                  <span>{fmtTime(ch.startSec)}</span>
                  <span className="chapter-item__dot">·</span>
                  <span>{fmtTime(chDur)}</span>
                </div>
                {isActive && (
                  <div className="chapter-item__progress">
                    <div
                      className="chapter-item__progress-fill"
                      style={{ width: `${progressRatio * 100}%` }}
                    />
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}