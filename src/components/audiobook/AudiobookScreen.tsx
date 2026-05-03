import React, { useCallback, useEffect, useRef, useState } from "react";
import { open } from "@tauri-apps/plugin-dialog";
import { C, FONT } from "@/styles";
import { ChapterList } from "./ChapterList";
import { PlayerBar } from "./PlayerBar";
import { useAudiobook } from "@/hooks/useAudiobook";
import type { Chapter, RecentBook, AudiobookCover } from "@/utils/audiobookApi";
import { getAudiobookCover, getRecentAudiobooks } from "@/utils/audiobookApi";
import type { PlayState } from "@/hooks/useAudiobook";

interface AudiobookScreenProps {
  onBack: () => void;
}

export function AudiobookScreen({ onBack }: AudiobookScreenProps) {
  const {
    meta, playState,
    currentChapter, currentChapterIndex, currentTime, speed,
    recentBooks: hookRecentBooks,
    openBook, play, pause, seekInChapter,
    goToChapter, nextChapter, prevChapter, setSpeed,
  } = useAudiobook();

  // hook 里的 recentBooks 可能是异步加载的，初始为空数组。
  // 用独立 state 管理，mount 时直接调 API，后续跟随 hook 更新。
  const [recentBooks, setRecentBooks] = useState<RecentBook[]>([]);

  // mount 时立即拉一次，不等 hook
  useEffect(() => {
    getRecentAudiobooks().then(setRecentBooks).catch(() => {});
  }, []);

  // hook 数据到来时（openBook 后会更新）同步覆盖
  useEffect(() => {
    if (hookRecentBooks.length > 0) {
      setRecentBooks(hookRecentBooks);
    }
  }, [hookRecentBooks]);

  const [sidebarOpen, setSidebarOpen] = useState(true);
  const [recentOpen, setRecentOpen] = useState(false);
  const [cover, setCover] = useState<AudiobookCover | null>(null);
  // Fix 3: track whether cover image has been decoded to avoid white flash
  const [coverReady, setCoverReady] = useState(false);
  const [showHelp, setShowHelp] = useState(false);
  const recentDropdownRef = useRef<HTMLDivElement>(null);

  // ── 打开文件 ───────────────────────────────────────────────────────────────

  const handleOpenBook = useCallback(async () => {
    setRecentOpen(false);
    const path = await open({
      multiple: false,
      filters: [
        { name: "有声书", extensions: ["m4b", "m4a", "mp3", "aac"] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (typeof path === "string") {
      setCover(null);
      setCoverReady(false);
      await openBook(path);
      getAudiobookCover(path).then(setCover).catch(() => {});
    }
  }, [openBook]);

  const handleOpenRecent = useCallback(async (book: RecentBook) => {
    setRecentOpen(false);
    setCover(null);
    setCoverReady(false);
    await openBook(book.path);
    getAudiobookCover(book.path).then(setCover).catch(() => {});
  }, [openBook]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const path = (file as unknown as { path?: string }).path ?? file.name;
    setCover(null);
    setCoverReady(false);
    await openBook(path);
    getAudiobookCover(path).then(setCover).catch(() => {});
  }, [openBook]);

  // ── 点击外部关闭最近下拉 ──────────────────────────────────────────────────

  useEffect(() => {
    if (!recentOpen) return;
    const handler = (e: MouseEvent) => {
      if (recentDropdownRef.current && !recentDropdownRef.current.contains(e.target as Node)) {
        setRecentOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [recentOpen]);

  // Fix 3: reset coverReady when cover object changes
  useEffect(() => {
    setCoverReady(false);
  }, [cover]);

  // ── 键盘快捷键 ────────────────────────────────────────────────────────────

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
        case "[":
          e.preventDefault();
          prevChapter();
          break;
        case "]":
          e.preventDefault();
          nextChapter();
          break;
        case "h":
        case "H":
          e.preventDefault();
          setShowHelp((v) => !v);
          break;
        case "Escape":
          e.preventDefault();
          if (showHelp) setShowHelp(false);
          break;
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [playState, play, pause, prevChapter, nextChapter, showHelp]);

  const isLoading = playState === "loading";

  return (
    <div
      style={s.root}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* ── 顶部工具栏 ─────────────────────────────────────────────────────── */}
      <div style={s.toolbar}>
        <button style={s.backBtn} onClick={onBack}>← 返回</button>
        <span style={s.modeTag}>有声书</span>

        {/* 折叠侧边栏按钮 */}
        <button
          style={s.iconBtn}
          onClick={() => setSidebarOpen((v) => !v)}
          title={sidebarOpen ? "隐藏章节列表" : "显示章节列表"}
        >
          <SidebarIcon open={sidebarOpen} />
        </button>

        <div style={s.divider} />

        {/* 打开有声书 + 最近下拉 */}
        <div style={s.openGroup} ref={recentDropdownRef}>
          <button style={s.openBtn} onClick={handleOpenBook}>
            打开有声书
          </button>
          {recentBooks.length > 0 && (
            <button
              style={{
                ...s.recentChevron,
                // 默认与"打开有声书"按钮同色，形成连体分段控件；
                // 打开下拉时切换为浅色背景 + 深色图标
                background: recentOpen ? C.paper2 : C.blue,
                color: recentOpen ? C.ink2 : "#fff",
                border: recentOpen
                  ? `1px solid ${C.border2}`
                  : "none",
                borderLeft: recentOpen
                  ? "none"
                  : "1px solid rgba(255,255,255,0.25)",
              }}
              onClick={() => setRecentOpen((v) => !v)}
              title="最近打开"
            >
              <ChevronIcon open={recentOpen} />
            </button>
          )}
          {recentOpen && (
            <div style={s.recentDropdown}>
              <div style={s.recentHeader}>最近打开</div>
              {recentBooks.map((book) => (
                <button
                  key={book.path}
                  style={s.recentItem}
                  onClick={() => handleOpenRecent(book)}
                >
                  <div style={s.recentTitle}>{book.title || pathBasename(book.path)}</div>
                  {book.author && <div style={s.recentAuthor}>{book.author}</div>}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* 书名 / 作者 */}
        {meta && (
          <div style={s.bookInfo}>
            <span style={s.bookTitle}>{meta.title}</span>
            {meta.author && <span style={s.bookAuthor}>{meta.author}</span>}
          </div>
        )}

        {/* Fix 1: 快捷键提示按钮（参考 PracticePanel 风格） */}
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 6, flexShrink: 0 }}>
          {isLoading && (
            <div style={s.loadingBadge}>
              <span style={s.loadingDot} /> 加载中…
            </div>
          )}
          <button style={s.helpBtn} onClick={() => setShowHelp(true)} title="键盘快捷键 (H)">
            快捷键 <KbdTag>H</KbdTag>
          </button>
        </div>
      </div>

      {/* ── 主体 ──────────────────────────────────────────────────────────── */}
      <div style={s.body}>
        {/* Fix 1: 始终渲染最近书列表入口，即使 meta 为 null */}
        {meta ? (
          <>
            {/* 左：章节列表（可折叠） */}
            <div style={{
              ...s.sidebar,
              width: sidebarOpen ? 260 : 0,
              opacity: sidebarOpen ? 1 : 0,
            }}>
              {sidebarOpen && (
                <ChapterList
                  chapters={meta.chapters}
                  currentIndex={currentChapterIndex}
                  currentTime={currentTime}
                  onSelect={(i) => goToChapter(i, 0)}
                />
              )}
            </div>

            {/* 右：正在播放 */}
            <div style={s.main}>
              <NowPlaying
                meta={meta}
                chapter={currentChapter}
                chapterIndex={currentChapterIndex}
                totalChapters={meta.chapters.length}
                playState={playState}
                cover={cover}
                coverReady={coverReady}
                onCoverReady={() => setCoverReady(true)}
              />
            </div>
          </>
        ) : (
          <EmptyState
            onOpen={handleOpenBook}
            loading={isLoading}
            // Fix 1: 在空状态也展示最近书，让用户无需点击"打开"也能快速访问
            recentBooks={recentBooks}
            onOpenRecent={handleOpenRecent}
          />
        )}
      </div>

      {/* ── 底部播放条 ─────────────────────────────────────────────────────── */}
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

      {/* ── 快捷键帮助弹窗 ─────────────────────────────────────────────────── */}
      {showHelp && (
        <div style={s.modalOverlay} onClick={() => setShowHelp(false)}>
          <div style={s.modalBox} onClick={(e) => e.stopPropagation()}>
            <div style={s.modalTitle}>键盘快捷键</div>
            <div style={s.modalCols}>
              {SHORTCUT_GROUPS.map((group) => (
                <div key={group.group} style={s.modalColGroup}>
                  <div style={s.modalGroup}>{group.group}</div>
                  {group.items.map(({ key, label }) => (
                    <div key={key} style={s.modalRow}>
                      <kbd style={s.modalKbd}>{key}</kbd>
                      <span style={s.modalLabel}>{label}</span>
                    </div>
                  ))}
                </div>
              ))}
            </div>
            <div style={s.modalFooter}>
              按 <kbd style={s.modalKbd}>H</kbd> 或 <kbd style={s.modalKbd}>Esc</kbd> 关闭
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

// ── 快捷键数据 ────────────────────────────────────────────────────────────────

const SHORTCUT_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: "播放",
    items: [
      { key: "Space", label: "播放 / 暂停" },
      { key: "[", label: "上一章节" },
      { key: "]", label: "下一章节" },
    ],
  },
  {
    group: "界面",
    items: [
      { key: "H", label: "显示 / 隐藏帮助" },
    ],
  },
];

// ── 正在播放面板 ───────────────────────────────────────────────────────────────

import type { AudiobookMeta } from "@/utils/audiobookApi";

function NowPlaying({
  meta, chapter, chapterIndex, totalChapters, playState, cover, coverReady, onCoverReady,
}: {
  meta: AudiobookMeta;
  chapter: Chapter | null;
  chapterIndex: number;
  totalChapters: number;
  playState: PlayState;
  cover: AudiobookCover | null;
  coverReady: boolean;
  onCoverReady: () => void;
}) {
  const [imgError, setImgError] = useState(false);
  const gradient = titleToGradient(meta.title);

  // Fix 3: only use coverSrc after image has decoded successfully
  const coverSrc = cover && !imgError
    ? `data:${cover.mimeType};base64,${cover.data}`
    : null;

  // 切换书时重置图片错误状态
  useEffect(() => { setImgError(false); }, [cover]);

  // Fix 3: show gradient background until img onLoad fires, prevents white flash
  const showCover = coverSrc && coverReady;

  return (
    <div style={np.wrap}>
      {/* 封面 */}
      <div style={{
        ...np.cover,
        background: showCover ? "transparent" : gradient,
      }}>
        {coverSrc && (
          <img
            src={coverSrc}
            alt={meta.title}
            style={{
              ...np.coverImg,
              // keep invisible until decoded, so gradient shows through instead of white
              opacity: coverReady ? 1 : 0,
              transition: "opacity 0.2s ease",
            }}
            draggable={false}
            onLoad={onCoverReady}
            onError={() => setImgError(true)}
          />
        )}
        {!showCover && (
          <span style={np.coverInitial}>
            {(meta.title || "?")[0].toUpperCase()}
          </span>
        )}
        {playState === "playing" && (
          <div style={np.playingBadge}>
            <PlayingDots />
          </div>
        )}
      </div>

      {/* 书名 + 作者 */}
      <div style={np.bookMeta}>
        <div style={np.bookTitle}>{meta.title}</div>
        {meta.author && <div style={np.bookAuthor}>{meta.author}</div>}
      </div>

      {/* 当前章节 */}
      {chapter && (
        <div style={np.chapterCard}>
          <div style={np.chapterBadge}>
            第 {chapterIndex + 1} / {totalChapters} 章
          </div>
          <div style={np.chapterTitle}>{chapter.title}</div>
        </div>
      )}
    </div>
  );
}

// 把书名映射到两个渐变色（确定性，不随机）
function titleToGradient(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  const palettes = [
    ["#6366F1", "#8B5CF6"], // indigo → violet
    ["#0EA5E9", "#6366F1"], // sky → indigo
    ["#10B981", "#0EA5E9"], // emerald → sky
    ["#F59E0B", "#EF4444"], // amber → red
    ["#EC4899", "#8B5CF6"], // pink → violet
    ["#14B8A6", "#6366F1"], // teal → indigo
    ["#F97316", "#EC4899"], // orange → pink
    ["#84CC16", "#10B981"], // lime → emerald
  ];
  const [a, b] = palettes[hash % palettes.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

function PlayingDots() {
  return (
    <svg width="28" height="16" viewBox="0 0 28 16" fill="white">
      <rect x="0" y="4" width="4" height="8" rx="2">
        <animate attributeName="height" values="8;14;8" dur="0.9s" repeatCount="indefinite" begin="0s" />
        <animate attributeName="y" values="4;1;4" dur="0.9s" repeatCount="indefinite" begin="0s" />
      </rect>
      <rect x="8" y="4" width="4" height="8" rx="2">
        <animate attributeName="height" values="8;14;8" dur="0.9s" repeatCount="indefinite" begin="0.15s" />
        <animate attributeName="y" values="4;1;4" dur="0.9s" repeatCount="indefinite" begin="0.15s" />
      </rect>
      <rect x="16" y="4" width="4" height="8" rx="2">
        <animate attributeName="height" values="8;14;8" dur="0.9s" repeatCount="indefinite" begin="0.3s" />
        <animate attributeName="y" values="4;1;4" dur="0.9s" repeatCount="indefinite" begin="0.3s" />
      </rect>
      <rect x="24" y="4" width="4" height="8" rx="2">
        <animate attributeName="height" values="8;14;8" dur="0.9s" repeatCount="indefinite" begin="0.45s" />
        <animate attributeName="y" values="4;1;4" dur="0.9s" repeatCount="indefinite" begin="0.45s" />
      </rect>
    </svg>
  );
}

// ── 空状态 ────────────────────────────────────────────────────────────────────

// Fix 1: EmptyState now receives and shows recentBooks
function EmptyState({
  onOpen,
  loading,
  recentBooks,
  onOpenRecent,
}: {
  onOpen: () => void;
  loading: boolean;
  recentBooks: RecentBook[];
  onOpenRecent: (book: RecentBook) => void;
}) {
  return (
    <div style={es.wrap}>
      <div style={es.icon}>📖</div>
      <p style={es.title}>{loading ? "正在解码…" : "还没有打开有声书"}</p>
      <p style={es.hint}>支持 M4B · M4A · MP3 · AAC</p>
      {!loading && (
        <button style={es.btn} onClick={onOpen}>选择文件</button>
      )}
      {!loading && <p style={es.dragHint}>或直接拖入文件</p>}

      {/* Fix 1: 最近打开书单，直接显示在空状态页面 */}
      {!loading && recentBooks.length > 0 && (
        <div style={es.recentSection}>
          <div style={es.recentHeader}>最近打开</div>
          <div style={es.recentList}>
            {recentBooks.map((book) => (
              <button
                key={book.path}
                style={es.recentItem}
                onClick={() => onOpenRecent(book)}
              >
                <div style={es.recentEmoji}>📚</div>
                <div style={es.recentMeta}>
                  <div style={es.recentTitle}>{book.title || pathBasename(book.path)}</div>
                  {book.author && <div style={es.recentAuthor}>{book.author}</div>}
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// ── 图标组件 ──────────────────────────────────────────────────────────────────

function KbdTag({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      fontFamily: FONT.mono,
      fontSize: 9,
      background: "rgba(0,0,0,0.06)",
      border: `0.5px solid ${C.border2}`,
      borderRadius: 3,
      padding: "0 4px",
      marginLeft: 5,
      verticalAlign: "middle",
      color: C.ink3,
    }}>
      {children}
    </kbd>
  );
}

function SidebarIcon({ open }: { open: boolean }) {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none">
      <rect x="1" y="2" width="14" height="12" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5" y1="2" x2="5" y2="14" stroke="currentColor" strokeWidth="1.2" />
      {open ? (
        <path d="M8.5 6L6.5 8L8.5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      ) : (
        <path d="M7.5 6L9.5 8L7.5 10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      )}
    </svg>
  );
}

function ChevronIcon({ open }: { open: boolean }) {
  return (
    <svg
      width="10" height="10" viewBox="0 0 10 10" fill="none"
      style={{ transform: open ? "rotate(180deg)" : "none", transition: "transform 0.15s" }}
    >
      <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function pathBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
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
    gap: 8,
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
    flexShrink: 0,
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
    flexShrink: 0,
  },
  iconBtn: {
    background: "none",
    border: "none",
    color: C.ink3,
    cursor: "pointer",
    padding: "5px 6px",
    display: "flex",
    alignItems: "center",
    borderRadius: 6,
    flexShrink: 0,
    transition: "background 0.1s, color 0.1s",
  },
  helpBtn: {
    fontFamily: FONT.sans,
    fontSize: 12,
    fontWeight: 500,
    background: "none",
    border: `0.5px solid ${C.border2}`,
    borderRadius: 6,
    padding: "4px 10px",
    cursor: "pointer",
    color: C.ink3,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
    transition: "background 0.1s, color 0.1s",
  },
  divider: {
    width: 1,
    height: 20,
    background: C.border,
    flexShrink: 0,
    marginLeft: 2,
    marginRight: 2,
  },
  openGroup: {
    position: "relative" as const,
    display: "flex",
    alignItems: "center",
    flexShrink: 0,
  },
  openBtn: {
    fontFamily: FONT.sans,
    fontSize: 12,
    fontWeight: 500,
    background: C.blue,
    color: "#fff",
    border: "none",
    borderRadius: "6px 0 0 6px",
    padding: "5px 13px",
    cursor: "pointer",
    whiteSpace: "nowrap" as const,
  },
  recentChevron: {
    border: `1px solid rgba(255,255,255,0.25)`,
    borderLeft: "none",
    borderRadius: "0 6px 6px 0",
    padding: "5px 7px",
    cursor: "pointer",
    color: "#fff",
    display: "flex",
    alignItems: "center",
    transition: "background 0.1s",
  },
  recentDropdown: {
    position: "absolute" as const,
    top: "calc(100% + 6px)",
    left: 0,
    minWidth: 240,
    background: C.paper,
    border: `0.5px solid ${C.border}`,
    borderRadius: 8,
    boxShadow: "0 8px 24px rgba(0,0,0,0.12)",
    zIndex: 100,
    overflow: "hidden",
  },
  recentHeader: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: C.ink3,
    padding: "10px 14px 6px",
    borderBottom: `0.5px solid ${C.border}`,
  },
  recentItem: {
    display: "block",
    width: "100%",
    textAlign: "left" as const,
    background: "none",
    border: "none",
    padding: "9px 14px",
    cursor: "pointer",
    transition: "background 0.1s",
  },
  recentTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: C.ink,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  recentAuthor: {
    fontSize: 11,
    color: C.ink3,
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  bookInfo: {
    display: "flex",
    alignItems: "baseline",
    gap: 8,
    overflow: "hidden",
    flex: 1,
    minWidth: 0,
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
    flexShrink: 0,
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
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
  },
  sidebar: {
    flexShrink: 0,
    overflow: "hidden",
    display: "flex",
    flexDirection: "column",
    transition: "width 0.22s cubic-bezier(0.4,0,0.2,1), opacity 0.18s ease",
  },
  main: {
    flex: 1,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  // Modal styles
  modalOverlay: {
    position: "fixed" as const,
    inset: 0,
    background: "rgba(0,0,0,0.45)",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 9999,
  },
  modalBox: {
    background: C.paper,
    border: `0.5px solid ${C.border}`,
    borderRadius: 16,
    padding: "32px 36px",
    width: 480,
    maxWidth: "90vw",
    boxShadow: "0 8px 40px rgba(0,0,0,0.18)",
  },
  modalTitle: {
    fontFamily: FONT.mono,
    fontSize: 13,
    letterSpacing: "0.10em",
    textTransform: "uppercase" as const,
    color: C.ink3,
    marginBottom: 24,
  },
  modalCols: {
    display: "grid",
    gridTemplateColumns: "1fr 1fr",
    gap: "4px 32px",
  },
  modalColGroup: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 0,
    marginBottom: 16,
  },
  modalGroup: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: "0.08em",
    textTransform: "uppercase" as const,
    color: C.ink3,
    marginBottom: 6,
    borderBottom: `0.5px solid ${C.border}`,
    paddingBottom: 4,
  },
  modalRow: {
    display: "flex",
    alignItems: "center",
    gap: 12,
    padding: "5px 0",
  },
  modalKbd: {
    fontFamily: FONT.mono,
    fontSize: 11,
    background: C.paper3,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 4,
    padding: "2px 8px",
    color: C.ink2,
    boxShadow: `0 1px 0 ${C.border2}`,
    minWidth: 40,
    textAlign: "center" as const,
    flexShrink: 0,
  },
  modalLabel: {
    fontSize: 13,
    color: C.ink,
    fontFamily: FONT.sans,
  },
  modalFooter: {
    marginTop: 24,
    fontSize: 12,
    color: C.ink3,
    fontFamily: FONT.mono,
    textAlign: "center" as const,
  },
};

const np: Record<string, React.CSSProperties> = {
  wrap: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 20,
    padding: "40px 48px",
    maxWidth: 640,
    width: "100%",
  },
  cover: {
    width: 260,
    height: 260,
    borderRadius: 20,
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    position: "relative" as const,
    boxShadow: "0 16px 48px rgba(0,0,0,0.25)",
    flexShrink: 0,
    overflow: "hidden" as const,
  },
  coverInitial: {
    fontSize: 96,
    fontWeight: 700,
    color: "rgba(255,255,255,0.9)",
    fontFamily: FONT.sans,
    lineHeight: 1,
    userSelect: "none",
    // Fix 3: position absolute so img can overlap it when ready
    position: "absolute" as const,
  },
  coverImg: {
    width: "100%",
    height: "100%",
    objectFit: "cover" as const,
    display: "block",
    position: "absolute" as const,
    inset: 0,
  },
  playingBadge: {
    position: "absolute" as const,
    bottom: 10,
    left: "50%",
    transform: "translateX(-50%)",
    background: "rgba(0,0,0,0.35)",
    borderRadius: 8,
    padding: "4px 8px",
    display: "flex",
    alignItems: "center",
    zIndex: 1,
  },
  bookMeta: {
    display: "flex",
    flexDirection: "column" as const,
    alignItems: "center",
    gap: 4,
    width: "100%",
  },
  bookTitle: {
    fontSize: 20,
    fontWeight: 700,
    color: C.ink,
    textAlign: "center" as const,
    lineHeight: 1.35,
    wordBreak: "break-word" as const,
  },
  bookAuthor: {
    fontSize: 14,
    color: C.ink3,
    textAlign: "center" as const,
  },
  chapterCard: {
    width: "100%",
    background: C.paper,
    border: `0.5px solid ${C.border}`,
    borderRadius: 10,
    padding: "12px 16px",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
  },
  chapterBadge: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: "0.08em",
    color: C.blue,
    background: C.blueLt,
    padding: "2px 8px",
    borderRadius: 4,
    alignSelf: "center",
  },
  chapterTitle: {
    fontSize: 15,
    fontWeight: 600,
    color: C.ink,
    lineHeight: 1.5,
    wordBreak: "break-word" as const,
    alignSelf: "center",
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
    padding: "32px 24px",
    overflowY: "auto",
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
  recentSection: {
    marginTop: 24,
    width: "100%",
    maxWidth: 360,
  },
  recentHeader: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    color: C.ink3,
    marginBottom: 10,
    paddingBottom: 6,
    borderBottom: `0.5px solid ${C.border}`,
  },
  recentList: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
  },
  recentItem: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    width: "100%",
    textAlign: "left" as const,
    background: C.paper,
    border: `0.5px solid ${C.border}`,
    borderRadius: 8,
    padding: "10px 14px",
    cursor: "pointer",
    transition: "background 0.1s",
  },
  recentEmoji: {
    fontSize: 20,
    flexShrink: 0,
  },
  recentMeta: {
    overflow: "hidden",
    flex: 1,
    minWidth: 0,
  },
  recentTitle: {
    fontSize: 13,
    fontWeight: 500,
    color: C.ink,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
  recentAuthor: {
    fontSize: 11,
    color: C.ink3,
    marginTop: 2,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap" as const,
  },
};