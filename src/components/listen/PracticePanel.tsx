import React, { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { C, FONT } from "@/styles";
import { Btn, MiniPlayer } from "@/components/shared/Primitives";
import { DiffView } from "./DiffView";
import { computeDiff } from "@/hooks/useDiff";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import type { ListenSegment, SegmentState, SegmentStatus } from "@/types/waveform";

interface PracticePanelProps {
  segment: ListenSegment | null;
  segState: SegmentState;
  audioUrl: string | undefined;
  totalCount: number;
  onUpdateText: (text: string) => void;
  onMarkStatus: (status: SegmentStatus) => void;
  onPrev: () => void;
  onNext: () => void;
  hasPrev: boolean;
  hasNext: boolean;
}

// ── 键盘快捷键说明 ─────────────────────────────────────────────────────────────
// P          播放 / 暂停（在 textarea 内也生效）
// R          从头重播
// Enter      切换「对照原文 / Diff」（textarea 内 Shift+Enter 换行正常输入）
// I          textarea 获得焦点（进入输入模式，类 Vim insert）
// Escape     textarea 失去焦点（回到面板快捷键模式）
// J          上一段
// L          下一段
// D          标记完成并跳下一段
// F          标记重听

export function PracticePanel({
  segment,
  segState,
  audioUrl,
  totalCount,
  onUpdateText,
  onMarkStatus,
  onPrev,
  onNext,
  hasPrev,
  hasNext,
}: PracticePanelProps) {
  const [showRef, setShowRef] = useState(false);
  const [textareaFocused, setTextareaFocused] = useState(false);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showHelp, setShowHelp] = useState(false);

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  // ref 版本，供不依赖 re-render 的回调（onFocusChanged、resize 事件）读取
  const textareaFocusedRef = useRef(false);

  const {
    playState, currentTime, duration,
    load, play, pause, seek,
  } = useAudioPlayer();

  const playing = playState === "playing";

  // ── textarea 焦点状态同步到 ref ──────────────────────────────────────────
  const handleTextareaFocus = useCallback(() => {
    setTextareaFocused(true);
    textareaFocusedRef.current = true;
  }, []);

  const handleTextareaBlur = useCallback(() => {
    setTextareaFocused(false);
    textareaFocusedRef.current = false;
  }, []);

  // ── 片段切换：加载新音频 ──────────────────────────────────────────────────
  useEffect(() => {
    if (audioUrl) load(audioUrl);
    setShowRef(false);
  }, [audioUrl]);

  // ── 自动聚焦面板，确保键盘快捷键开箱即用 ────────────────────────────────
  useEffect(() => {
    if (segment) panelRef.current?.focus();
  }, [segment]);

  // ── 窗口焦点恢复 & 全屏切换后重新聚焦 ───────────────────────────────────
  useEffect(() => {
    const win = getCurrentWindow();
    let unlistenFocus: (() => void) | undefined;
    let unlistenResize: (() => void) | undefined;

    // 应用切换回来时恢复焦点
    win.onFocusChanged(({ payload: focused }) => {
      if (focused && !textareaFocusedRef.current) {
        panelRef.current?.focus();
      }
    }).then((fn) => { unlistenFocus = fn; });

    return () => {
      unlistenFocus?.();
      unlistenResize?.();
    };
  }, []); // 无依赖，只注册一次，通过 ref 读取最新状态

  // ── 播放控制 ──────────────────────────────────────────────────────────────
  const handlePlay = useCallback(() => play(), [play]);
  const handlePause = useCallback(() => pause(), [pause]);
  const handleReplay = useCallback(() => play(0), [play]);
  const handleTogglePlay = useCallback(() => {
    playing ? pause() : play();
  }, [playing, play, pause]);

  const handleSeek = useCallback((sec: number) => seek(sec), [seek]);

  const navTo = useCallback((fn: () => void) => {
    pause();
    fn();
  }, [pause]);

  // PracticePanel.tsx 内部

  const handleToggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    const isNowFs = await win.isFullscreen();
    const nextFs = !isNowFs;

    // 1. 先切换全屏状态
    await win.setFullscreen(nextFs);
    setIsFullscreen(nextFs);

    // 2. 定义一个核心的“焦点抓取”函数
    const forceRecoverFocus = async () => {

      try {
        // 步骤 A: 强行拉起系统窗口焦点（解决叮叮响的关键）
        await win.setFocus();

        // 步骤 B: 强行唤醒 Webview 内部环境
        window.focus();

        // 步骤 C: 重新定向 DOM 焦点
        if (!textareaFocusedRef.current && panelRef.current) {
          panelRef.current.blur(); // 先重置
          panelRef.current.focus(); // 后聚焦
        }
      } catch (e) {
        // 忽略可能的权限报错
      }
    };

    // 3. 退出全屏时，启动“三段式”恢复频率
    // 不同的电脑和系统（macOS/Win）全屏动画时长不同，用三个频率覆盖它们
    if (!nextFs) {
      setTimeout(forceRecoverFocus, 200);  // 动画初期尝试
      setTimeout(forceRecoverFocus, 500);  // 动画结束尝试（大部分情况在此生效）
      setTimeout(forceRecoverFocus, 1000); // 兜底尝试
    }
  }, [setIsFullscreen]); // 移除不必要的依赖，保持函数引用稳定

  useEffect(() => {
    getCurrentWindow().isFullscreen().then(setIsFullscreen);
  }, []);

  // ── 标记操作 ──────────────────────────────────────────────────────────────
  const handleMarkDone = useCallback(() => {
    onMarkStatus("done");
    if (hasNext) navTo(onNext);
  }, [onMarkStatus, hasNext, navTo, onNext]);

  const handleMarkFlagged = useCallback(() => {
    onMarkStatus("flagged");
  }, [onMarkStatus]);

  // ── 全键盘操作 ─────────────────────────────────────────────────────────────
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      console.log("keydown:", e.key, "activeElement:", document.activeElement?.tagName);
      const inTextarea =
        document.activeElement === textareaRef.current;

      switch (e.key) {
        case "p":
        case "P": {
          if (inTextarea) break;
          e.preventDefault();
          handleTogglePlay();
          break;
        }
        case "r":
        case "R": {
          if (inTextarea) break;
          e.preventDefault();
          handleReplay();
          break;
        }
        case "Enter": {
          if (inTextarea) break;
          e.preventDefault();
          setShowRef((v) => !v);
          break;
        }
        case "j":
        case "J": {
          if (inTextarea) break;
          e.preventDefault();
          if (hasPrev) navTo(onPrev);
          break;
        }
        case "l":
        case "L": {
          if (inTextarea) break;
          e.preventDefault();
          if (hasNext) navTo(onNext);
          break;
        }
        case "d":
        case "D": {
          if (inTextarea) break;
          e.preventDefault();
          handleMarkDone();
          break;
        }
        case "f":
        case "F": {
          if (inTextarea) break;
          e.preventDefault();
          handleMarkFlagged();
          break;
        }
        case "z":
        case "Z": {
          if (inTextarea) break;
          e.preventDefault();
          handleToggleFullscreen();
          break;
        }
        case "h":
        case "H": {
          if (inTextarea) break;
          e.preventDefault();
          setShowHelp((v) => !v);
          break;
        }
        case "i":
        case "I": {
          if (inTextarea) break;
          e.preventDefault();
          textareaRef.current?.focus();
          break;
        }
        case "Escape": {
          e.preventDefault();

          if (showHelp) {
            setShowHelp(false);
            return;
          }

          if (inTextarea) {
            textareaRef.current?.blur();
          }
          break;
        }
      }
    };

    window.addEventListener("keydown", handler);

    // 监听窗口重新获得焦点的全局事件
    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        // 只要窗口被激活，就强行把焦点拉回到 Webview 和 Panel
        window.focus();
        if (!textareaFocusedRef.current) {
          panelRef.current?.focus();
        }
      }
    });

    return () => {
      window.removeEventListener("keydown", handler);
      unlisten.then(fn => fn());
    };
    // 注意：只保留最稳定的依赖，或者使用 Ref 来引用变动的值
  }, [handleTogglePlay, handleReplay, hasPrev, hasNext, navTo, onPrev, onNext, handleMarkDone, handleMarkFlagged, handleToggleFullscreen, showHelp]);

  // ── 渲染 ───────────────────────────────────────────────────────────────────

  if (!segment) {
    return (
      <div style={{ ...s.main, alignItems: "center", justifyContent: "center" }}>
        <p style={{ color: C.ink3, fontSize: 14 }}>请从左侧选择一个片段</p>
      </div>
    );
  }

  const diff = showRef ? computeDiff(segState.userText, segment.text) : null;

  return (
    <div
      ref={panelRef}
      style={s.main}
      tabIndex={0}
    >
      {/* 片段信息 */}
      <div style={s.segInfo}>
        <span style={s.segNum}>片段 #{segment.index + 1} / {totalCount}</span>
        {segment.label && <span style={s.segLabel}>{segment.label}</span>}
        <span style={s.segDur}>{(segment.end - segment.start).toFixed(1)}s</span>
        <div style={{ marginLeft: "auto", display: "flex", alignItems: "center", gap: 8 }}>
          <Btn variant="ghost" size="sm" onClick={() => setShowHelp(true)} style={{ fontSize: 12 }}>
            快捷键 <KbdTag>H</KbdTag>
          </Btn>
          <Btn variant="ghost" size="sm" onClick={handleToggleFullscreen} style={{ fontSize: 12 }}>
            {isFullscreen ? "退出全屏" : "全屏"} <KbdTag>Z</KbdTag>
          </Btn>
        </div>
      </div>

      {/* 播放器 */}
      <MiniPlayer
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        disabled={!audioUrl || playState === "loading"}
        onPlay={handlePlay}
        onPause={handlePause}
        onSeek={handleSeek}
        onReplay={handleReplay}
      />

      {/* 听写输入区 */}
      <div style={s.section}>
        <div style={s.sectionLabel}>
          听写内容
          {textareaFocused && (
            <span style={s.focusBadge}>输入中 · Esc 退出输入模式</span>
          )}
        </div>
        <textarea
          ref={textareaRef}
          style={{
            ...s.textarea,
            borderColor: textareaFocused ? C.blueMid : C.border2,
            boxShadow: textareaFocused ? `0 0 0 2px ${C.blueLt}` : "none",
          }}
          value={segState.userText}
          placeholder="点击此处输入，或直接开始打字…"
          onChange={(e) => onUpdateText(e.target.value)}
          onFocus={handleTextareaFocus}
          onBlur={handleTextareaBlur}
          rows={3}
        />
      </div>

      {/* 原文区（默认隐藏） */}
      <div style={s.section}>
        <div style={s.refHead}>
          <div style={s.sectionLabel}>原文</div>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => setShowRef((v) => !v)}
            style={{ fontSize: 11 }}
          >
            {showRef ? "隐藏原文" : "对照原文"}
            <span style={s.kbdInline}>Enter</span>
          </Btn>
        </div>

        {showRef && (
          <>
            <div style={s.refText}>
              {segment.text || <em style={{ color: C.ink3 }}>（无转写文本）</em>}
            </div>
            {segState.userText.trim() && segment.text && diff && (
              <DiffView result={diff} />
            )}
          </>
        )}
      </div>

      {/* 操作按钮 */}
      <div style={s.controls}>
        <Btn variant="success" onClick={handleMarkDone}>
          ✓ 完成 <KbdTag>D</KbdTag>
        </Btn>
        <Btn variant="danger" onClick={handleMarkFlagged}>
          ⚑ 标记重听 <KbdTag>F</KbdTag>
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" onClick={() => navTo(onPrev)} disabled={!hasPrev}>
          ← 上一段 <KbdTag>J</KbdTag>
        </Btn>
        <Btn variant="primary" onClick={() => navTo(onNext)} disabled={!hasNext}>
          下一段 → <KbdTag>L</KbdTag>
        </Btn>
      </div>
      {/* 快捷键帮助弹窗 */}
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

// ── 快捷键数据（按分组，两列排布）────────────────────────────────────────────

const SHORTCUT_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: "播放",
    items: [
      { key: "P", label: "播放 / 暂停" },
      { key: "R", label: "从头重播" },
    ],
  },
  {
    group: "输入",
    items: [
      { key: "I", label: "进入输入模式" },
      { key: "Esc", label: "退出输入模式" },
    ],
  },
  {
    group: "对照",
    items: [
      { key: "Enter", label: "对照 / 隐藏原文" },
    ],
  },
  {
    group: "导航",
    items: [
      { key: "J", label: "上一段" },
      { key: "L", label: "下一段" },
    ],
  },
  {
    group: "标记",
    items: [
      { key: "D", label: "完成并跳下一段" },
      { key: "F", label: "标记重听" },
    ],
  },
  {
    group: "界面",
    items: [
      { key: "Z", label: "切换全屏" },
      { key: "H", label: "显示 / 隐藏帮助" },
    ],
  },
];

// ── 小组件 ────────────────────────────────────────────────────────────────────

function KbdTag({ children }: { children: React.ReactNode }) {
  return (
    <kbd style={{
      fontFamily: FONT.mono,
      fontSize: 9,
      background: "rgba(255,255,255,0.15)",
      border: "0.5px solid rgba(255,255,255,0.25)",
      borderRadius: 3,
      padding: "0 4px",
      marginLeft: 5,
      verticalAlign: "middle",
    }}>
      {children}
    </kbd>
  );
}

// ── 样式 ──────────────────────────────────────────────────────────────────────

const s: Record<string, React.CSSProperties> = {
  main: {
    flex: 1,
    display: "flex",
    flexDirection: "column",
    padding: "36px 56px",
    gap: 28,
    overflowY: "auto",
    outline: "none",
  },
  segInfo: {
    display: "flex",
    alignItems: "center",
    gap: 14,
    flexWrap: "wrap" as const,
  },
  segNum: {
    fontFamily: FONT.mono,
    fontSize: 20,
    color: C.blue,
    fontWeight: 700,
    letterSpacing: "-0.01em",
  },
  segLabel: {
    fontSize: 14,
    color: C.ink2,
    background: C.paper2,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 6,
    padding: "4px 12px",
  },
  segDur: {
    fontFamily: FONT.mono,
    fontSize: 13,
    color: C.ink3,
  },
  kbdRow: {  // kept for potential reuse
    display: "flex",
    alignItems: "center",
    gap: 14,
    marginLeft: "auto",
    flexWrap: "wrap" as const,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 12,
    flexShrink: 0,
  },
  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: 11,
    letterSpacing: "0.10em",
    textTransform: "uppercase" as const,
    color: C.ink3,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  focusBadge: {
    fontSize: 11,
    color: C.blue,
    background: C.blueLt,
    borderRadius: 3,
    padding: "2px 8px",
    fontFamily: FONT.mono,
    letterSpacing: "0.04em",
  },
  textarea: {
    width: "100%",
    border: `0.5px solid ${C.border2}`,
    borderRadius: 12,
    padding: "18px 22px",
    fontFamily: FONT.sans,
    fontSize: 18,
    color: C.ink,
    background: C.paper,
    outline: "none",
    lineHeight: 1.9,
    resize: "none" as const,
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  refHead: {
    display: "flex",
    alignItems: "center",
    justifyContent: "space-between",
  },
  refText: {
    background: C.paper2,
    border: `0.5px solid ${C.border}`,
    borderRadius: 12,
    padding: "18px 22px",
    fontSize: 18,
    color: C.ink,
    lineHeight: 1.9,
    fontFamily: FONT.sans,
  },
  kbdInline: {
    fontFamily: FONT.mono,
    fontSize: 10,
    background: C.paper3,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 3,
    padding: "0 5px",
    marginLeft: 6,
    color: C.ink3,
    verticalAlign: "middle",
    boxShadow: `0 1px 0 ${C.border2}`,
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    flexWrap: "wrap" as const,
    flexShrink: 0,
    marginTop: "auto",
    paddingTop: 8,
  },
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
    width: 580,
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
  modalGrid: {  // unused, kept for safety
    display: "flex",
    flexDirection: "column" as const,
    gap: 4,
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