import React, { useState, useEffect, useRef, useCallback } from "react";
import { getCurrentWindow } from "@tauri-apps/api/window";
import { Btn, MiniPlayer } from "@/components/shared/Primitives";
import { DiffView } from "./DiffView";
import { computeDiff } from "@/hooks/useDiff";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { useSpeechInput } from "@/hooks/useSpeechInput";
import type { ListenSegment, SegmentState, SegmentStatus } from "@/types/waveform";
import "./PracticePanel.scss";

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
// V          开始 / 停止语音识别

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

  // 语音识别：已确认文字的"基座"（不含临时 interim）
  const confirmedTextRef = useRef(segState.userText);
  // 当前展示的 interim 预览文字
  const [interimPreview, setInterimPreview] = useState("");

  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const textareaFocusedRef = useRef(false);

  const {
    playState, currentTime, duration,
    load, play, pause, seek,
  } = useAudioPlayer();

  const playing = playState === "playing";

  // ── 语音回调 ──────────────────────────────────────────────────────────────

  const handleTranscript = useCallback((text: string, isFinal: boolean) => {
    if (isFinal) {
      const base = confirmedTextRef.current;
      const joined = base
        ? (base.endsWith(" ") || base.endsWith("\n") ? base + text : base + " " + text)
        : text;
      confirmedTextRef.current = joined;
      setInterimPreview("");
      onUpdateText(joined);
    } else {
      setInterimPreview(text);
    }
  }, [onUpdateText]);

  const { speechState, toggleListening, stopListening } = useSpeechInput(
    handleTranscript,
    { model: "base" },
  );

  const isListening = speechState === "listening";
  const isTranscribing = speechState === "transcribing";
  const speechUnsupported = speechState === "unsupported";

  useEffect(() => {
    if (!isListening) setInterimPreview("");
  }, [isListening]);

  useEffect(() => {
    stopListening();
    confirmedTextRef.current = segState.userText;
    setInterimPreview("");
  }, [segment?.index]); // 仅在片段切换时触发

  useEffect(() => {
    if (!isListening) {
      confirmedTextRef.current = segState.userText;
    }
  }, [segState.userText, isListening]);

  const displayText = isListening && interimPreview
    ? (segState.userText
        ? (segState.userText.endsWith(" ") || segState.userText.endsWith("\n")
            ? segState.userText + interimPreview
            : segState.userText + " " + interimPreview)
        : interimPreview)
    : segState.userText;

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

  // ── 自动聚焦面板 ──────────────────────────────────────────────────────────

  useEffect(() => {
    if (segment) panelRef.current?.focus();
  }, [segment]);

  // ── 窗口焦点恢复 ─────────────────────────────────────────────────────────

  useEffect(() => {
    const win = getCurrentWindow();
    let unlistenFocus: (() => void) | undefined;

    win.onFocusChanged(({ payload: focused }) => {
      if (focused && !textareaFocusedRef.current) {
        panelRef.current?.focus();
      }
    }).then((fn) => { unlistenFocus = fn; });

    return () => { unlistenFocus?.(); };
  }, []);

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

  const handleToggleFullscreen = useCallback(async () => {
    const win = getCurrentWindow();
    const isNowFs = await win.isFullscreen();
    const nextFs = !isNowFs;
    await win.setFullscreen(nextFs);
    setIsFullscreen(nextFs);

    const forceRecoverFocus = async () => {
      try {
        await win.setFocus();
        window.focus();
        if (!textareaFocusedRef.current && panelRef.current) {
          panelRef.current.blur();
          panelRef.current.focus();
        }
      } catch (_) {}
    };

    if (!nextFs) {
      setTimeout(forceRecoverFocus, 200);
      setTimeout(forceRecoverFocus, 500);
      setTimeout(forceRecoverFocus, 1000);
    }
  }, [setIsFullscreen]);

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
      const inTextarea = document.activeElement === textareaRef.current;

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
        case "v":
        case "V": {
          if (inTextarea) break;
          e.preventDefault();
          if (!speechUnsupported) toggleListening();
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

    const win = getCurrentWindow();
    const unlisten = win.onFocusChanged(({ payload: focused }) => {
      if (focused) {
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
  }, [handleTogglePlay, handleReplay, hasPrev, hasNext, navTo, onPrev, onNext, handleMarkDone, handleMarkFlagged, handleToggleFullscreen, showHelp, speechUnsupported, toggleListening]);

  // ── 渲染 ───────────────────────────────────────────────────────────────────

  if (!segment) {
    return (
      <div className="practice practice--empty">
        <p className="practice__empty-hint">请从左侧选择一个片段</p>
      </div>
    );
  }

  // textarea modifier class
  const textareaClass = [
    "practice__textarea",
    isListening    ? "practice__textarea--listening"    : "",
    isTranscribing ? "practice__textarea--transcribing" : "",
    (!isListening && !isTranscribing && textareaFocused) ? "practice__textarea--focused" : "",
  ].filter(Boolean).join(" ");

  const diff = showRef ? computeDiff(segState.userText, segment.text) : null;

  return (
    <div
      ref={panelRef}
      className="practice"
      tabIndex={0}
    >
      {/* 片段信息 */}
      <div className="practice__seg-info">
        <span className="practice__seg-num">片段 #{segment.index + 1} / {totalCount}</span>
        {segment.label && <span className="practice__seg-label">{segment.label}</span>}
        <span className="practice__seg-dur">{(segment.end - segment.start).toFixed(1)}s</span>
        <div className="practice__seg-actions">
          <Btn variant="ghost" size="sm" onClick={() => setShowHelp(true)} style={{ fontSize: 12 }}>
            快捷键 <kbd className="kbd kbd--inline">H</kbd>
          </Btn>
          <Btn variant="ghost" size="sm" onClick={handleToggleFullscreen} style={{ fontSize: 12 }}>
            {isFullscreen ? "退出全屏" : "全屏"} <kbd className="kbd kbd--inline">Z</kbd>
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
      <div className="practice__section">
        <div className="practice__section-label">
          听写内容
          {!isListening && !isTranscribing && textareaFocused && (
            <span className="practice__badge practice__badge--focus">输入中 · Esc 退出输入模式</span>
          )}
          {isListening && (
            <span className="practice__badge practice__badge--speech">
              <span className="practice__speech-dot" />
              录音中
            </span>
          )}
          {isTranscribing && (
            <span className="practice__badge practice__badge--transcribing">
              <span className="practice__speech-spinner" />
              Whisper 转写中…
            </span>
          )}
        </div>

        {/* 语音按钮 */}
        {!speechUnsupported && (
          <div className="practice__speech-row">
            <button
              className={[
                "practice__speech-btn",
                isListening    ? "practice__speech-btn--active"   : "",
                isTranscribing ? "practice__speech-btn--disabled" : "",
              ].filter(Boolean).join(" ")}
              onClick={toggleListening}
              disabled={isTranscribing}
              title={
                isTranscribing
                  ? "正在转写，请稍候"
                  : isListening
                    ? "停止录音并转写 (V)"
                    : "开始录音 (V)"
              }
            >
              <MicIcon active={isListening} />
              {isTranscribing
                ? "转写中…"
                : isListening
                  ? "停止录音"
                  : "语音输入"}
              {!isTranscribing && <kbd className="kbd kbd--inline">V</kbd>}
            </button>
            {isListening && interimPreview && (
              <span className="practice__interim-hint">
                识别中：{interimPreview}
              </span>
            )}
          </div>
        )}

        <textarea
          ref={textareaRef}
          className={textareaClass}
          value={displayText}
          placeholder={
            isListening
              ? "正在录音，再次按 V 或点击按钮停止…"
              : isTranscribing
                ? "正在转写录音…"
                : "点击此处输入，或直接开始打字…"
          }
          onChange={(e) => {
            if (isListening) stopListening();
            confirmedTextRef.current = e.target.value;
            onUpdateText(e.target.value);
          }}
          onFocus={handleTextareaFocus}
          onBlur={handleTextareaBlur}
          rows={3}
        />
      </div>

      {/* 原文区（默认隐藏） */}
      <div className="practice__section">
        <div className="practice__ref-head">
          <div className="practice__section-label">原文</div>
          <Btn
            variant="ghost"
            size="sm"
            onClick={() => setShowRef((v) => !v)}
            style={{ fontSize: 11 }}
          >
            {showRef ? "隐藏原文" : "对照原文"}
            <kbd className="kbd kbd--inline">Enter</kbd>
          </Btn>
        </div>

        {showRef && (
          <>
            <div className="practice__ref-text">
              {segment.text || <em style={{ color: "var(--color-ink-3)" }}>（无转写文本）</em>}
            </div>
            {segState.userText.trim() && segment.text && diff && (
              <DiffView result={diff} />
            )}
          </>
        )}
      </div>

      {/* 操作按钮 */}
      <div className="practice__controls">
        <Btn variant="success" onClick={handleMarkDone}>
          ✓ 完成 <kbd className="kbd kbd--inline">D</kbd>
        </Btn>
        <Btn variant="danger" onClick={handleMarkFlagged}>
          ⚑ 标记重听 <kbd className="kbd kbd--inline">F</kbd>
        </Btn>
        <div className="practice__controls-spacer" />
        <Btn variant="ghost" onClick={() => navTo(onPrev)} disabled={!hasPrev}>
          ← 上一段 <kbd className="kbd kbd--inline">J</kbd>
        </Btn>
        <Btn variant="primary" onClick={() => navTo(onNext)} disabled={!hasNext}>
          下一段 → <kbd className="kbd kbd--inline">L</kbd>
        </Btn>
      </div>

      {/* 快捷键帮助弹窗 —— 复用全局 .modal-overlay + .modal-card */}
      {showHelp && (
        <div className="modal-overlay" onClick={() => setShowHelp(false)}>
          <div className="modal-card" onClick={(e) => e.stopPropagation()}>
            <div className="modal-card__title">键盘快捷键</div>
            <ShortcutGrid />
            <div className="modal-card__footer">
              按 <kbd className="kbd">H</kbd> 或 <kbd className="kbd">Esc</kbd> 关闭
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
      { key: "P", label: "播放 / 暂停" },
      { key: "R", label: "从头重播" },
    ],
  },
  {
    group: "输入",
    items: [
      { key: "I", label: "进入输入模式" },
      { key: "Esc", label: "退出输入模式" },
      { key: "V", label: "语音输入 开/关" },
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

// 弹窗内快捷键网格，使用全局 .kbd 样式
function ShortcutGrid() {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 32px" }}>
      {SHORTCUT_GROUPS.map((group) => (
        <div key={group.group} style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 16 }}>
          <div style={{
            fontFamily: "var(--font-mono)",
            fontSize: "var(--font-size-xs)",
            letterSpacing: "0.08em",
            textTransform: "uppercase" as const,
            color: "var(--color-ink-3)",
            marginBottom: 6,
            borderBottom: "0.5px solid var(--color-border)",
            paddingBottom: 4,
          }}>
            {group.group}
          </div>
          {group.items.map(({ key, label }) => (
            <div key={key} style={{ display: "flex", alignItems: "center", gap: 12, padding: "5px 0" }}>
              <kbd className="kbd">{key}</kbd>
              <span style={{ fontSize: "var(--font-size-base)", color: "var(--color-ink-1)", fontFamily: "var(--font-sans)" }}>
                {label}
              </span>
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

// ── 小组件 ────────────────────────────────────────────────────────────────────

function MicIcon({ active }: { active: boolean }) {
  return (
    <svg
      width="14" height="14" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      style={{ marginRight: 5, flexShrink: 0 }}
    >
      <rect x="9" y="2" width="6" height="11" rx="3" fill={active ? "currentColor" : "none"} />
      <path d="M5 10a7 7 0 0 0 14 0" />
      <line x1="12" y1="19" x2="12" y2="22" />
      <line x1="8" y1="22" x2="16" y2="22" />
    </svg>
  );
}