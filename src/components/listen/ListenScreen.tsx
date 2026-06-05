import React, { useCallback } from "react";
import { Btn, TbSep } from "@/components/shared/Primitives";
import { SegmentSidebar } from "./SegmentSidebar";
import { PracticePanel } from "./PracticePanel";
import { usePack } from "@/hooks/usePack";
import type { SegmentStatus } from "@/types/waveform";
import "./ListenScreen.scss";

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
  const currentState = segStates.get(currentIndex) ?? {
    status: "pending" as SegmentStatus,
    userText: "",
  };

  const handleFileInput = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (file) await loadZip(file);
      e.target.value = "";
    },
    [loadZip],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (file && (file.name.endsWith(".zip") || file.type === "application/zip")) {
        await loadZip(file);
      }
    },
    [loadZip],
  );

  const total = segments.length;
  const doneCount = [...segStates.values()].filter((s) => s.status === "done").length;

  return (
    <div className="listen" onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      {/* 顶栏 */}
      <div className="listen__toolbar">
        <Btn
          variant="ghost"
          size="sm"
          onClick={onBack}
          style={{ fontSize: 12, padding: "4px 10px" }}
        >
          ← 返回
        </Btn>
        <TbSep />
        <span className="listen__mode-tag">精听练习</span>
        <TbSep />

        {/* 导入按钮 */}
        <label className="listen__import-btn">
          <input type="file" accept=".zip" onChange={handleFileInput} />
          导入 ZIP
        </label>

        <div className="listen__toolbar-spacer" />

        {meta && (
          <span className="listen__progress">
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
        <div className="listen__body">
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

function EmptyState({
  onFileInput,
}: {
  onFileInput: (e: React.ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="listen__empty">
      <div className="listen__empty-texture" />
      <div className="listen__empty-content">
        <div className="listen__drop-box">
          <div className="listen__drop-icon">📦</div>
          <p className="listen__drop-title">拖入 ZIP 数据包</p>
          <p className="listen__drop-hint">或点击下方按钮选择文件</p>
          <label className="listen__import-btn" style={{ marginTop: 12 }}>
            <input type="file" accept=".zip" onChange={onFileInput} />
            选择 ZIP 文件
          </label>
        </div>
        <p className="listen__empty-note">
          数据包由「音频标注」模式导出，包含音频片段与 Whisper 转写文本
        </p>
      </div>
    </div>
  );
}

function LoadingState() {
  return (
    <div className="listen__loading">
      <div className="listen__loading-spinner" />
      <p className="listen__loading-text">正在解压数据包…</p>
    </div>
  );
}

function ErrorState({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <div className="listen__error">
      <p className="listen__error-title">导入失败</p>
      <p className="listen__error-msg">{error}</p>
      <Btn variant="ghost" size="sm" onClick={onRetry}>
        重试
      </Btn>
    </div>
  );
}
