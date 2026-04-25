import React, { useState, useEffect, useRef, useCallback } from "react";
import { C, FONT } from "@/styles";
import { Btn, MiniPlayer } from "@/components/shared/Primitives";
import { DiffView } from "./DiffView";
import { computeDiff } from "@/hooks/useDiff";
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
// Tab        播放 / 暂停（在 textarea 内也生效）
// R          从头重播
// Enter      切换「对照原文 / Diff」（textarea 内 Shift+Enter 换行正常输入）
// J          上一段
// L          下一段
// Escape     textarea 失去焦点（回到面板快捷键模式）
// 点击听写框  获得焦点（输入文字）

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
  const [playing, setPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  // 原文和 Diff 共用一个开关：false=隐藏, true=展示原文+diff
  const [showRef, setShowRef] = useState(false);
  const [textareaFocused, setTextareaFocused] = useState(false);

  const audioRef    = useRef<HTMLAudioElement | null>(null);
  const rafRef      = useRef<number>(0);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const panelRef    = useRef<HTMLDivElement | null>(null);

  // ── 片段切换：重置所有状态 ─────────────────────────────────────────────────

  useEffect(() => {
    setPlaying(false);
    setCurrentTime(0);
    setDuration(0);
    setShowRef(false);
    cancelAnimationFrame(rafRef.current);

    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    audio.currentTime = 0;
    audio.src = audioUrl ?? "";
    if (audioUrl) audio.load();
  }, [audioUrl, segment?.index]);

  // ── 播放器逻辑 ─────────────────────────────────────────────────────────────

  const tick = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    setCurrentTime(audio.currentTime);
    if (!audio.paused) rafRef.current = requestAnimationFrame(tick);
  }, []);

  const handlePlay = useCallback(() => {
    const audio = audioRef.current;
    if (!audio || !audioUrl) return;
    audio.play();
    setPlaying(true);
    rafRef.current = requestAnimationFrame(tick);
  }, [audioUrl, tick]);

  const handlePause = useCallback(() => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.pause();
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
  }, []);

  const handleTogglePlay = useCallback(() => {
    playing ? handlePause() : handlePlay();
  }, [playing, handlePlay, handlePause]);

  const handleEnded = () => {
    setPlaying(false);
    cancelAnimationFrame(rafRef.current);
    if (audioRef.current) setCurrentTime(audioRef.current.duration);
  };

  const handleSeek = (sec: number) => {
    const audio = audioRef.current;
    if (!audio) return;
    audio.currentTime = sec;
    setCurrentTime(sec);
  };

  const handleReplay = useCallback(() => {
    handleSeek(0);
    handlePlay();
  }, [handlePlay]);

  const navTo = useCallback((fn: () => void) => {
    handlePause();
    fn();
  }, [handlePause]);

  // ── 全键盘操作 ─────────────────────────────────────────────────────────────
  // 挂在面板容器上，tabIndex=-1 使其可聚焦接收键盘事件

  const handleKeyDown = useCallback((e: React.KeyboardEvent) => {
    const inTextarea = textareaFocused;

    switch (e.key) {
      // Tab：播放/暂停（在 textarea 内也劫持，防止焦点跳走）
      case "Tab": {
        e.preventDefault();
        handleTogglePlay();
        break;
      }

      // R：重播（textarea 内不劫持，避免阻止正常输入 r）
      case "r":
      case "R": {
        if (inTextarea) break;
        e.preventDefault();
        handleReplay();
        break;
      }

      // Enter：切换对照（textarea 内用 Shift+Enter 触发，普通 Enter 换行）
      case "Enter": {
        if (inTextarea && !e.shiftKey) break;
        e.preventDefault();
        setShowRef((v) => !v);
        break;
      }

      // J：上一段（textarea 内不劫持）
      case "j":
      case "J": {
        if (inTextarea) break;
        e.preventDefault();
        if (hasPrev) navTo(onPrev);
        break;
      }

      // L：下一段（textarea 内不劫持）
      case "l":
      case "L": {
        if (inTextarea) break;
        e.preventDefault();
        if (hasNext) navTo(onNext);
        break;
      }

      // Escape：textarea 失焦，回到面板快捷键模式
      case "Escape": {
        if (inTextarea) {
          textareaRef.current?.blur();
          panelRef.current?.focus();
        }
        break;
      }
    }
  }, [
    textareaFocused, handleTogglePlay, handleReplay,
    hasPrev, hasNext, navTo, onPrev, onNext,
  ]);

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
      tabIndex={-1}
      onKeyDown={handleKeyDown}
    >
      <audio
        ref={audioRef}
        onLoadedMetadata={() => { if (audioRef.current) setDuration(audioRef.current.duration); }}
        onEnded={handleEnded}
        preload="metadata"
      />

      {/* 片段信息 + 快捷键提示 */}
      <div style={s.segInfo}>
        <span style={s.segNum}>片段 #{segment.index + 1} / {totalCount}</span>
        {segment.label && <span style={s.segLabel}>{segment.label}</span>}
        <span style={s.segDur}>{(segment.end - segment.start).toFixed(1)}s</span>
        <div style={s.kbdRow}>
          <KbdHint keys={["Tab"]} label="播放/暂停" />
          <KbdHint keys={["R"]} label="重播" />
          <KbdHint keys={["Enter"]} label="对照" />
          <KbdHint keys={["J"]} label="上一段" />
          <KbdHint keys={["L"]} label="下一段" />
          <KbdHint keys={["Esc"]} label="退出输入" />
        </div>
      </div>

      {/* 播放器 */}
      <MiniPlayer
        playing={playing}
        currentTime={currentTime}
        duration={duration}
        disabled={!audioUrl}
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
          onFocus={() => setTextareaFocused(true)}
          onBlur={() => setTextareaFocused(false)}
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
            {/* 原文纯文本 */}
            <div style={s.refText}>
              {segment.text || <em style={{ color: C.ink3 }}>（无转写文本）</em>}
            </div>
            {/* Diff（只有原文和用户输入都非空时才渲染） */}
            {segState.userText.trim() && segment.text && diff && (
              <DiffView result={diff} />
            )}
          </>
        )}
      </div>

      {/* 操作按钮 */}
      <div style={s.controls}>
        <Btn variant="success" onClick={() => { onMarkStatus("done"); hasNext && navTo(onNext); }}>
          ✓ 完成
        </Btn>
        <Btn variant="danger" onClick={() => onMarkStatus("flagged")}>
          ⚑ 标记重听
        </Btn>
        <div style={{ flex: 1 }} />
        <Btn variant="ghost" onClick={() => navTo(onPrev)} disabled={!hasPrev}>
          ← 上一段 <KbdTag>J</KbdTag>
        </Btn>
        <Btn variant="primary" onClick={() => navTo(onNext)} disabled={!hasNext}>
          下一段 → <KbdTag>L</KbdTag>
        </Btn>
      </div>
    </div>
  );
}

// ── 小组件 ────────────────────────────────────────────────────────────────────

function KbdHint({ keys, label }: { keys: string[]; label: string }) {
  return (
    <span style={{ display: "flex", alignItems: "center", gap: 3 }}>
      {keys.map((k) => (
        <kbd key={k} style={{
          fontFamily: FONT.mono,
          fontSize: 9,
          background: C.paper3,
          border: `0.5px solid ${C.border2}`,
          borderRadius: 3,
          padding: "1px 4px",
          color: C.ink2,
          boxShadow: `0 1px 0 ${C.border2}`,
        }}>
          {k}
        </kbd>
      ))}
      <span style={{ fontSize: 9.5, color: C.ink3 }}>{label}</span>
    </span>
  );
}

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
    padding: "clamp(14px, 2.5vh, 32px) clamp(16px, 2.5vw, 40px)",
    gap: "clamp(10px, 1.5vh, 20px)",
    overflowY: "auto",
    outline: "none",
  },
  textarea: {
    width: "100%",
    border: `0.5px solid ${C.border2}`,
    borderRadius: 10,
    padding: "clamp(8px, 1.2vh, 14px) clamp(10px, 1vw, 16px)",
    fontFamily: FONT.sans,
    fontSize: "clamp(13px, 1.1vw, 16px)",  // ← 随窗口缩放
    color: C.ink,
    background: C.paper,
    outline: "none",
    lineHeight: 1.7,
    resize: "none" as const,
    transition: "border-color 0.15s, box-shadow 0.15s",
  },
  refText: {
    background: C.paper2,
    border: `0.5px solid ${C.border}`,
    borderRadius: 10,
    padding: "clamp(8px, 1.2vh, 14px) clamp(10px, 1vw, 16px)",
    fontSize: "clamp(13px, 1.1vw, 16px)",  // ← 同上
    color: C.ink,
    lineHeight: 1.7,
    fontFamily: FONT.sans,
  },
  segNum: {
    fontFamily: FONT.mono,
    fontSize: "clamp(11px, 0.9vw, 14px)",
    color: C.blue,
    fontWeight: 500,
  },
  segLabel: {
    fontSize: 12,
    color: C.ink2,
    background: C.paper2,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 4,
    padding: "1px 7px",
  },
  segDur: {
    fontFamily: FONT.mono,
    fontSize: 10,
    color: C.ink3,
  },
  kbdRow: {
    display: "flex",
    alignItems: "center",
    gap: 10,
    marginLeft: "auto",
    flexWrap: "wrap" as const,
  },
  section: {
    display: "flex",
    flexDirection: "column",
    gap: 6,
    flexShrink: 0,
  },
  sectionLabel: {
    fontFamily: FONT.mono,
    fontSize: 9.5,
    letterSpacing: "0.10em",
    textTransform: "uppercase" as const,
    color: C.ink3,
    display: "flex",
    alignItems: "center",
    gap: 8,
  },
  focusBadge: {
    fontSize: 9,
    color: C.blue,
    background: C.blueLt,
    borderRadius: 3,
    padding: "1px 6px",
    fontFamily: FONT.mono,
    letterSpacing: "0.04em",
  },
  textarea: {
    width: "100%",
    border: `0.5px solid ${C.border2}`,
    borderRadius: 10,
    padding: "10px 13px",
    fontFamily: FONT.sans,
    fontSize: 14,
    color: C.ink,
    background: C.paper,
    outline: "none",
    lineHeight: 1.7,
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
    borderRadius: 10,
    padding: "10px 13px",
    fontSize: 14,
    color: C.ink,
    lineHeight: 1.7,
    fontFamily: FONT.sans,
  },
  kbdInline: {
    fontFamily: FONT.mono,
    fontSize: 9,
    background: C.paper3,
    border: `0.5px solid ${C.border2}`,
    borderRadius: 3,
    padding: "0 4px",
    marginLeft: 5,
    color: C.ink3,
    verticalAlign: "middle",
    boxShadow: `0 1px 0 ${C.border2}`,
  },
  controls: {
    display: "flex",
    alignItems: "center",
    gap: 7,
    flexWrap: "wrap" as const,
    flexShrink: 0,
    marginTop: "auto",
    paddingTop: 4,
  },
};