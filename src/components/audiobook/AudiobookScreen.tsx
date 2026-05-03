import React, { useCallback } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { C, FONT } from "@/styles";
import { ChapterList } from "./ChapterList";
import { PlayerBar } from "./PlayerBar";
import { useAudiobook } from "@/hooks/useAudiobook";

interface AudiobookScreenProps {
  onBack: () => void;
}

export function AudiobookScreen({ onBack }: AudiobookScreenProps) {
  const {
    meta, playState,
    currentChapter, currentChapterIndex, currentTime, speed,
    openBook, play, pause, seekInChapter,
    goToChapter, nextChapter, prevChapter, setSpeed,
  } = useAudiobook();

  const handleOpenBook = useCallback(async () => {
    const path = await open({
      multiple: false,
      filters: [
        { name: "有声书", extensions: ["m4b", "m4a", "mp3", "aac"] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (typeof path === "string") await openBook(path);
  }, [openBook]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const path = (file as unknown as { path?: string }).path ?? file.name;
    await openBook(path);
  }, [openBook]);

  const isLoading = playState === "loading";

  return (
    <div
      style={s.root}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* 顶部工具栏 */}
      <div style={s.toolbar}>
        <button style={s.backBtn} onClick={onBack}>← 返回</button>
        <span style={s.modeTag}>有声书</span>
        {meta && (
          <div style={s.bookInfo}>
            <span style={s.bookTitle}>{meta.title}</span>
            {meta.author && <span style={s.bookAuthor}>{meta.author}</span>}
          </div>
        )}
        {isLoading && (
          <div style={s.loadingBadge}>
            <span style={s.loadingDot} /> 加载中…
          </div>
        )}
      </div>

      {/* 主体：左侧章节列表 + 右侧占位/封面区 */}
      <div style={s.body}>
        {meta ? (
          <>
            {/* 左：章节列表 */}
            <div style={s.sidebar}>
              <ChapterList
                chapters={meta.chapters}
                currentIndex={currentChapterIndex}
                currentTime={currentTime}
                onSelect={(i) => goToChapter(i, 0)}
              />
            </div>

            {/* 右：当前章节信息 */}
            <div style={s.main}>
              <NowPlaying
                chapter={currentChapter}
                chapterIndex={currentChapterIndex}
                totalChapters={meta.chapters.length}
                currentTime={currentTime}
                playState={playState}
              />
            </div>
          </>
        ) : (
          <EmptyState onOpen={handleOpenBook} loading={isLoading} />
        )}
      </div>

      {/* 底部播放条 */}
      <PlayerBar
        playState={playState}
        currentChapter={currentChapter}
        currentChapterIndex={currentChapterIndex}
        totalChapters={meta?.chapters.length ?? 0}
        currentTime={currentTime}
        speed={speed}
        onPlay={play}
        onPause={pause}
        onPrev={prevChapter}
        onNext={nextChapter}
        onSeek={seekInChapter}
        onSpeedChange={setSpeed}
        onOpenBook={handleOpenBook}
      />
    </div>
  );
}

// ── 正在播放面板 ───────────────────────────────────────────────────────────────

import type { Chapter } from "@/utils/audiobookApi";
import type { PlayState } from "@/hooks/useAudiobook";

function NowPlaying({
  chapter, chapterIndex, totalChapters, currentTime, playState,
}: {
  chapter: Chapter | null;
  chapterIndex: number;
  totalChapters: number;
  currentTime: number;
  playState: PlayState;
}) {
  if (!chapter) return null;
  const chDur = chapter.endSec - chapter.startSec;
  const pct = chDur > 0 ? Math.min(100, (currentTime / chDur) * 100) : 0;

  return (
    <div style={np.wrap}>
      {/* 大圆形进度 */}
      <div style={np.ringWrap}>
        <svg width={160} height={160} viewBox="0 0 160 160">
          <circle cx={80} cy={80} r={70} fill="none" stroke={C.border} strokeWidth={6} />
          <circle
            cx={80} cy={80} r={70}
            fill="none"
            stroke={C.blue}
            strokeWidth={6}
            strokeLinecap="round"
            strokeDasharray={`${2 * Math.PI * 70}`}
            strokeDashoffset={`${2 * Math.PI * 70 * (1 - pct / 100)}`}
            transform="rotate(-90 80 80)"
            style={{ transition: "stroke-dashoffset 0.5s linear" }}
          />
        </svg>
        <div style={np.ringCenter}>
          <div style={np.pct}>{Math.round(pct)}%</div>
          <div style={np.playStateDot}>
            {playState === "playing" ? "▶" : "⏸"}
          </div>
        </div>
      </div>

      <div style={np.chapterNum}>
        第 {chapterIndex + 1} / {totalChapters} 章
      </div>
      <div style={np.chapterTitle}>{chapter.title}</div>
    </div>
  );
}

// ── 空状态 ────────────────────────────────────────────────────────────────────

function EmptyState({ onOpen, loading }: { onOpen: () => void; loading: boolean }) {
  return (
    <div style={es.wrap}>
      <div style={es.icon}>📖</div>
      <p style={es.title}>{loading ? "正在解码…" : "还没有打开有声书"}</p>
      <p style={es.hint}>支持 M4B · M4A · MP3 · AAC</p>
      {!loading && (
        <button style={es.btn} onClick={onOpen}>选择文件</button>
      )}
      {!loading && (
        <p style={es.dragHint}>或直接拖入文件</p>
      )}
    </div>
  );
}

// ── 样式 ──────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100vw",
    height: "100vh",
    background: C.paper2,
    overflow: "hidden",
    userSelect: "none",
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    padding: "0 16px",
    height: 48,
    background: C.paper,
    borderBottom: `0.5px solid ${C.border}`,
    flexShrink: 0,
    boxShadow: "0 1px 0 rgba(26,39,68,0.04)",
  },
  backBtn: {
    fontFamily: FONT.sans,
    fontSize: 12,
    fontWeight: 500,
    borderRadius: 6,
    padding: "5px 12px",
    cursor: "pointer",
    background: C.paper,
    color: C.ink,
    border: `1px solid ${C.border2}`,
    whiteSpace: "nowrap" as const,
  },
  modeTag: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: "0.12em",
    textTransform: "uppercase" as const,
    color: C.green,
    padding: "2px 7px",
    background: C.greenLt,
    borderRadius: 4,
  },
  bookInfo: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    overflow: "hidden",
    flex: 1,
  },
  bookTitle: {
    fontSize: 14,
    fontWeight: 600,
    color: C.ink,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  bookAuthor: {
    fontSize: 12,
    color: C.ink3,
    whiteSpace: "nowrap" as const,
  },
  loadingBadge: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    fontSize: 12,
    color: "#D97706",
    fontWeight: 500,
    flexShrink: 0,
  },
  loadingDot: {
    width: 6,
    height: 6,
    borderRadius: "50%",
    background: "#D97706",
    display: "inline-block",
    animation: "spin 1s linear infinite",
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  sidebar: {
    width: 260,
    flexShrink: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
  },
  main: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
};

const np: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    padding: 40,
  },
  ringWrap: {
    position: "relative",
    width: 160,
    height: 160,
  },
  ringCenter: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  pct: {
    fontFamily: FONT.mono,
    fontSize: 24,
    fontWeight: 700,
    color: C.ink,
    letterSpacing: "-0.04em",
  },
  playStateDot: {
    fontSize: 12,
    color: C.blue,
  },
  chapterNum: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: C.ink3,
    letterSpacing: "0.06em",
  },
  chapterTitle: {
    fontSize: 18,
    fontWeight: 600,
    color: C.ink,
    textAlign: "center" as const,
    maxWidth: 320,
    lineHeight: 1.4,
  },
};

const es: Record<string, React.CSSProperties> = {
  wrap: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 12,
    color: C.ink3,
  },
  icon: { fontSize: 48, lineHeight: 1, marginBottom: 4 },
  title: { fontSize: 16, color: C.ink2, fontWeight: 500 },
  hint: { fontSize: 13, fontFamily: FONT.mono, color: C.ink3 },
  btn: {
    fontFamily: FONT.sans,
    fontSize: 13,
    fontWeight: 500,
    background: C.blue,
    color: "#fff",
    border: "none",
    borderRadius: 8,
    padding: "8px 24px",
    cursor: "pointer",
    marginTop: 8,
  },
  dragHint: { fontSize: 12, color: C.border2, fontFamily: FONT.mono },
};