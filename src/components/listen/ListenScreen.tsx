import React, { useCallback } from "react";
import { C, FONT } from "@/styles";
import { Btn, TbSep } from "@/components/shared/Primitives";
import { SegmentSidebar } from "./SegmentSidebar";
import { PracticePanel } from "./PracticePanel";
import { usePack } from "@/hooks/usePack";
import type { SegmentStatus } from "@/types/waveform";

interface ListenScreenProps {
  onBack: () => void;
}

export function ListenScreen({ onBack }: ListenScreenProps) {
  const {
    pack,
    loadZip,
    isLoading,
    error,
    setCurrentIndex,
    updateSegState,
    markStatus,
    getAudioUrl,
    getCurrentSeg,
  } = usePack();

  const { meta, segStates, currentIndex } = pack;
  const segments = meta?.segments ?? [];
  const currentSeg = getCurrentSeg();
  const currentState = segStates.get(currentIndex) ?? { status: "pending" as SegmentStatus, userText: "" };

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await loadZip(file);
      e.target.value = "";
    },
    [loadZip]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".zip") || file.type === "application/zip")) {
        await loadZip(file);
      }
    },
    [loadZip]
  );

  const total = segments.length;
  const doneCount = [...segStates.values()].filter((s) => s.status === "done").length;

  return (
    <div
      style={s.root}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      {/* 顶栏 */}
      <div style={s.topbar}>
        <Btn variant="ghost" size="sm" onClick={onBack} style={{ fontSize: 12, padding: "4px 10px" }}>
          ← 返回
        </Btn>
        <TbSep />
        <span style={s.modeTag}>精听练习</span>
        <TbSep />

        {/* 导入按钮 */}
        <label style={{ cursor: "pointer" }}>
          <input type="file" accept=".zip" style={{ display: "none" }} onChange={handleFileInput} />
          <Btn variant="primary" size="sm" style={{ pointerEvents: "none" }}>
            导入 ZIP
          </Btn>
        </label>

        <div style={{ flex: 1 }} />

        {meta && (
          <span style={s.progress}>
            {doneCount} / {total} 片段已完成
          </span>
        )}
      </div>

      {/* 主体 */}
      {isLoading ? (
        <LoadingState />
      ) : error ? (
        <ErrorState error={error} onRetry={() => {}} />
      ) : !meta ? (
        <EmptyState onFileInput={handleFileInput} />
      ) : (
        <div style={s.body}>
          <SegmentSidebar
            segments={segments}
            segStates={segStates}
            currentIndex={currentIndex}
            onSelect={setCurrentIndex}
          />
          <PracticePanel
            segment={currentSeg}
            segState={currentState}
            audioUrl={currentSeg ? getAudioUrl(currentSeg.index) : undefined}
            totalCount={total}
            onUpdateText={(text) => updateSegState(currentIndex, { userText: text })}
            onMarkStatus={(status) => markStatus(currentIndex, status)}
            onPrev={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
            onNext={() => setCurrentIndex(Math.min(total - 1, currentIndex + 1))}
            hasPrev={currentIndex > 0}
            hasNext={currentIndex < total - 1}
          />
        </div>
      )}
    </div>
  );
}

// ── 空状态（未导入 ZIP） ──────────────────────────────────────────────────────

function EmptyState({ onFileInput }: { onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void }) {
  return (
    <div style={s.empty}>
      {/* 纸质纹理 */}
      <div style={s.emptyTexture} />
      <div style={s.emptyContent}>
        <div style={s.dropBox}>
          <div style={s.dropIcon}>📦</div>
          <p style={s.dropTitle}>拖入 ZIP 数据包</p>
          <p style={s.dropHint}>或点击下方按钮选择文件</p>
          <label style={{ marginTop: 12, cursor: "pointer" }}>
            <input type="file" accept=".zip" style={{ display: "none" }} onChange={onFileInput} />
            <Btn variant="primary" size="md" style={{ pointerEvents: "none" }}>
              选择 ZIP 文件
            </Btn>
          </label>
        </div>
        <p style={s.emptyNote}>
          数据包由「音频标注」模式导出，包含音频片段与 Whisper 转写文本
        </p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 12 }}>
      <div style={{ width: 24, height: 24, border: `2px solid ${C.border}`, borderTop: `2px solid ${C.blue}`, borderRadius: "50%", animation: "spin 0.8s linear infinite" }} />
      <p style={{ fontSize: 13, color: C.ink3 }}>正在解压数据包…</p>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div style={{ flex: 1, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 10 }}>
      <p style={{ fontSize: 14, color: C.red, fontWeight: 500 }}>导入失败</p>
      <p style={{ fontSize: 12, color: C.ink3, fontFamily: FONT.mono, maxWidth: 400, textAlign: "center" }}>{error}</p>
      <Btn variant="ghost" size="sm" onClick={onRetry}>重试</Btn>
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
  },
  topbar: {
    display: "flex",
    alignItems: "center",
    gap: 5,
    padding: "0 14px",
    height: 46,
    background: C.paper,
    borderBottom: `0.5px solid ${C.border}`,
    flexShrink: 0,
    boxShadow: "0 1px 0 rgba(26,39,68,0.04)",
  },
  modeTag: {
    fontFamily: FONT.mono,
    fontSize: 10,
    letterSpacing: "0.10em",
    textTransform: "uppercase" as const,
    color: C.green,
    padding: "2px 7px",
    background: C.greenLt,
    borderRadius: 3,
  },
  progress: {
    fontFamily: FONT.mono,
    fontSize: 11,
    color: C.ink3,
  },
  body: {
    flex: 1,
    display: "flex",
    overflow: "hidden",
    background: C.paper,
  },
  empty: {
    flex: 1,
    position: "relative",
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    overflow: "hidden",
  },
  emptyTexture: {
    position: "absolute",
    inset: 0,
    backgroundImage: `
      linear-gradient(${C.border} 1px, transparent 1px),
      linear-gradient(90deg, ${C.border} 1px, transparent 1px)
    `,
    backgroundSize: "40px 40px",
    opacity: 0.5,
    pointerEvents: "none",
  },
  emptyContent: {
    position: "relative",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 16,
    animation: "fadeIn 0.3s ease both",
  },
  dropBox: {
    background: C.paper,
    border: `1.5px dashed ${C.border2}`,
    borderRadius: 16,
    padding: "36px 48px",
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
    boxShadow: "0 2px 12px rgba(26,39,68,0.06)",
    transition: "border-color 0.15s",
  },
  dropIcon: { fontSize: 40, lineHeight: 1, marginBottom: 4 },
  dropTitle: { fontSize: 16, fontWeight: 500, color: C.ink },
  dropHint: { fontSize: 13, color: C.ink3 },
  emptyNote: {
    fontSize: 12,
    color: C.ink3,
    fontFamily: FONT.mono,
    textAlign: "center" as const,
    maxWidth: 380,
    lineHeight: 1.6,
  },
};