import React, { useEffect, useRef } from "react";
import { C, FONT } from "@/styles";
import type { Chapter } from "@/utils/audiobookApi";

interface ChapterListProps {
  chapters: Chapter[];
  currentIndex: number;
  currentTime: number; // 章节内秒数（用于显示进度）
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

  // 当前章节变化时滚动进视图
  useEffect(() => {
    activeRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [currentIndex]);

  return (
    <div style={s.container}>
      <div style={s.header}>
        <span style={s.headerLabel}>章节</span>
        <span style={s.headerCount}>{chapters.length} 章</span>
      </div>
      <div style={s.list}>
        {chapters.map((ch, i) => {
          const isActive = i === currentIndex;
          const chDur = ch.endSec - ch.startSec;
          // 当前章节显示播放进度条
          const progressRatio = isActive && chDur > 0 ? Math.min(1, currentTime / chDur) : 0;

          return (
            <div
              key={ch.index}
              ref={isActive ? activeRef : undefined}
              style={{
                ...s.item,
                background: isActive ? C.blueLt : "transparent",
                borderLeft: `2.5px solid ${isActive ? C.blue : "transparent"}`,
              }}
              onClick={() => onSelect(i)}
            >
              {/* 章节序号 */}
              <div style={{ ...s.idx, color: isActive ? C.blue : C.ink3 }}>
                {isActive ? (
                  <PlayingIcon />
                ) : (
                  String(i + 1).padStart(2, "0")
                )}
              </div>

              {/* 标题 + 进度 */}
              <div style={s.info}>
                <div style={{
                  ...s.title,
                  color: isActive ? C.ink : C.ink2,
                  fontWeight: isActive ? 600 : 400,
                }}>
                  {ch.title}
                </div>
                <div style={s.meta}>
                  <span>{fmtTime(ch.startSec)}</span>
                  <span style={s.dot}>·</span>
                  <span>{fmtTime(chDur)}</span>
                </div>
                {/* 当前章节进度条 */}
                {isActive && (
                  <div style={s.progressTrack}>
                    <div style={{ ...s.progressFill, width: `${progressRatio * 100}%` }} />
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

function PlayingIcon() {
  return (
    <svg width="12" height="12" viewBox="0 0 12 12" fill="none">
      <rect x="1" y="2" width="3" height="8" rx="1" fill="currentColor">
        <animate attributeName="height" values="8;4;8" dur="1s" repeatCount="indefinite" />
        <animate attributeName="y" values="2;4;2" dur="1s" repeatCount="indefinite" />
      </rect>
      <rect x="8" y="2" width="3" height="8" rx="1" fill="currentColor">
        <animate attributeName="height" values="8;6;3;8" dur="1.3s" repeatCount="indefinite" />
        <animate attributeName="y" values="2;3;4.5;2" dur="1.3s" repeatCount="indefinite" />
      </rect>
    </svg>
  );
}

const s: Record<string, React.CSSProperties> = {
  container: {
    display: "flex",
    flexDirection: "column",
    height: "100%",
    background: C.paper2,
    borderRight: `0.5px solid ${C.border}`,
    overflow: "hidden",
  },
  header: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
    padding: "14px 16px 10px",
    borderBottom: `0.5px solid ${C.border}`,
    flexShrink: 0,
  },
  headerLabel: {
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: C.ink3,
  },
  headerCount: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: C.ink3,
  },
  list: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "4px 0",
  },
  item: {
    display: "flex",
    alignItems: "flex-start",
    gap: 10,
    padding: "10px 14px",
    cursor: "pointer",
    transition: "background 0.1s",
    paddingLeft: 12,
  },
  idx: {
    fontFamily: FONT.mono,
    fontSize: 11,
    minWidth: 20,
    textAlign: "center" as const,
    paddingTop: 2,
    flexShrink: 0,
  },
  info: {
    flex: 1,
    display: "flex",
    flexDirection: "column" as const,
    gap: 3,
    minWidth: 0,
  },
  title: {
    fontSize: 13,
    lineHeight: 1.4,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  meta: {
    display: "flex",
    alignItems: "center",
    gap: 4,
    fontFamily: FONT.mono,
    fontSize: 10,
    color: C.ink3,
  },
  dot: { opacity: 0.5 },
  progressTrack: {
    height: 2,
    background: C.border2,
    borderRadius: 1,
    overflow: "hidden",
    marginTop: 4,
  },
  progressFill: {
    height: "100%",
    background: C.blue,
    borderRadius: 1,
    transition: "width 0.5s linear",
  },
};