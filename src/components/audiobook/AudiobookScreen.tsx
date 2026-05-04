import React, { useCallback, useEffect, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { getCurrentWebview } from "@tauri-apps/api/webview";
import { useAudiobook } from "@/hooks/useAudiobook";
import {
  getAudiobookCover,
  removeRecentAudiobook,
  type AudiobookCover,
  type RecentBook,
} from "@/utils/audiobookApi";
import { ChapterList } from "./ChapterList";
import { PlayerBar } from "./PlayerBar";
import { NowPlaying } from "./NowPlaying";
import { EmptyState } from "./EmptyState";
import { LoadingModal } from "./LoadingModal";
import { ShortcutModal } from "./ShortcutModal";
import { SidebarIcon } from "./icons";
import "./AudiobookScreen.scss";

interface AudiobookScreenProps { onBack: () => void; }

export function AudiobookScreen({ onBack }: AudiobookScreenProps) {
  const {
    meta, playState,
    currentChapter, currentChapterIndex, currentTime, speed,
    recentBooks, openBook, play, pause, seekInChapter,
    goToChapter, nextChapter, prevChapter, setSpeed,
  } = useAudiobook();

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [cover, setCover] = useState<AudiobookCover | null>(null);
  const [showHelp, setShowHelp] = useState(false);
  // 删除最近书时本地立刻反映（hook 内部不持有最近书的删除逻辑，所以维护一份镜像）
  const [localRecent, setLocalRecent] = useState<RecentBook[]>([]);

  // hook 数据来了就同步覆盖（包括删到 0 的情况，所以不要 length > 0 守卫）
  useEffect(() => { setLocalRecent(recentBooks); }, [recentBooks]);

  // ── 打开 / 拖入 ────────────────────────────────────────────────────────────

  const openBookWithCover = useCallback(async (path: string) => {
    setCover(null);
    try {
      await openBook(path);
      const c = await getAudiobookCover(path);
      setCover(c);
    } catch (err) {
      console.error("[audiobook] open failed:", err);
    }
  }, [openBook]);

  const handleOpenBook = useCallback(async () => {
    const path = await open({
      multiple: false,
      filters: [
        { name: "有声书", extensions: ["m4b", "m4a", "mp3", "aac"] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (typeof path === "string") {
      await openBookWithCover(path);
    }
  }, [openBook]);

  const handleOpenRecent = useCallback(async (book: RecentBook) => {
    await openBookWithCover(book.path);
  }, [openBookWithCover]);

  const handleRemoveRecent = useCallback(async (book: RecentBook) => {
    // 乐观更新
    setLocalRecent((list) => list.filter((b) => b.path !== book.path));
    try {
      await removeRecentAudiobook(book.path);
    } catch (err) {
      console.error("remove recent failed:", err);
      // 失败回滚
      setLocalRecent((list) => [...list, book].sort((a, b) => b.lastOpened - a.lastOpened));
    }
  }, []);

  // ── Tauri 原生拖拽（拿到真实文件路径）─────────────────────────────────
  useEffect(() => {
    let unlisten: (() => void) | undefined;

    getCurrentWebview()
      .onDragDropEvent((event) => {
        if (event.payload.type === "drop") {
          const paths = event.payload.paths;
          if (!paths || paths.length === 0) return;
          const path = paths[0];
          // 简单后缀过滤，避免拖入图片/文档
          if (!/\.(m4b|m4a|mp3|aac)$/i.test(path)) return;

          openBookWithCover(path);
        }
      })
      .then((fn) => { unlisten = fn; })
      .catch((err) => { console.error("[audiobook] drag listener:", err); });

    return () => { unlisten?.(); };
  }, [openBook]);

  // ── 快捷键 ────────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA") return;

      switch (e.key) {
        case " ":
          e.preventDefault();
          if (playState === "playing") pause();
          else if (playState === "ready" || playState === "paused") play();
          break;
        case "[": e.preventDefault(); prevChapter(); break;
        case "]": e.preventDefault(); nextChapter(); break;
        case "h":
        case "H": e.preventDefault(); setShowHelp((v) => !v); break;
        case "Escape": e.preventDefault(); if (showHelp) setShowHelp(false); break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [playState, play, pause, prevChapter, nextChapter, showHelp]);

  // 延迟 200ms 显示加载弹窗，避免缓存命中时一闪而过
  const [showLoadingModal, setShowLoadingModal] = useState(false);
  useEffect(() => {
    if (playState !== "loading") {
      setShowLoadingModal(false);
      return;
    }
    const timer = setTimeout(() => setShowLoadingModal(true), 200);
    return () => clearTimeout(timer);
  }, [playState]);

  return (
    <div
      className="audiobook"
    >
      {/* ── 顶部工具栏 ─────────────────────────────────────────────────── */}
      <div className="audiobook__toolbar">
        <button className="btn btn--ghost btn--sm" onClick={onBack}>← 返回</button>
        <span className="audiobook__mode-tag">有声书</span>

        <button
          className="btn btn--icon"
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "隐藏章节列表" : "显示章节列表"}
        >
          <SidebarIcon open={sidebarOpen} />
        </button>

        <div className="audiobook__divider" />

        <button className="btn btn--primary btn--sm" onClick={handleOpenBook}>
          打开有声书
        </button>

        {meta && (
          <div className="audiobook__book-info">
            <span className="audiobook__book-title">{meta.title}</span>
            {meta.author && (
              <span className="audiobook__book-author">{meta.author}</span>
            )}
          </div>
        )}

        <div className="audiobook__toolbar-spacer" />

        <button
          className="btn btn--text btn--sm"
          onClick={() => setShowHelp(true)}
          title="键盘快捷键 (H)"
        >
          快捷键 <kbd className="kbd kbd--inline">H</kbd>
        </button>
      </div>

      {/* ── 主体 ──────────────────────────────────────────────────────── */}
      <div className="audiobook__body">
        {meta ? (
          <>
            <div
              className="audiobook__sidebar"
              style={{
                width: sidebarOpen ? 260 : 0,
                opacity: sidebarOpen ? 1 : 0,
              }}
            >
              {sidebarOpen && (
                <ChapterList
                  chapters={meta.chapters}
                  currentIndex={currentChapterIndex}
                  currentTime={currentTime}
                  onSelect={(i) => goToChapter(i, 0)}
                />
              )}
            </div>

            <div className="audiobook__main">
              <NowPlaying
                meta={meta}
                chapter={currentChapter}
                chapterIndex={currentChapterIndex}
                totalChapters={meta.chapters.length}
                playState={playState}
                cover={cover}
              />
            </div>
          </>
        ) : (
          <EmptyState
            onOpen={handleOpenBook}
            recentBooks={localRecent}
            onOpenRecent={handleOpenRecent}
            onRemoveRecent={handleRemoveRecent}
          />
        )}
      </div>

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
      />

      {showHelp && <ShortcutModal onClose={() => setShowHelp(false)} />}

      {showLoadingModal && (
        <LoadingModal
          title="正在打开有声书"
          subtitle={meta?.title}
        />
      )}
    </div>
  );
}