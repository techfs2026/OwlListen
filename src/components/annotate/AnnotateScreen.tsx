import React, { useState, useEffect, useRef, useCallback } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { C } from "@/styles";
import { AnnotateToolbar } from "./AnnotateToolbar";
import { WaveformCanvas } from "./WaveformCanvas";
import { TimeAxis } from "./TimeAxis";
import { LabelList } from "./LabelList";
import { ExportPanel, type ExportProgress } from "./ExportPanel";
import { useWaveform } from "@/hooks/useWaveform";
import { useLabels } from "@/hooks/useLabels";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { splitAudio, transcribeSegments, buildZip, getTempDir } from "@/utils/tauriApi";

interface AnnotateScreenProps {
  onBack: () => void;
}

export function AnnotateScreen({ onBack }: AnnotateScreenProps) {
  const {
    audioInfo, loadingState, viewRange,
    loadFile: loadWaveform, fetchPeaks, setViewRange,
    zoomIn, zoomOut, zoomReset, scrollBy,
  } = useWaveform();

  const {
    labels, addLabel, removeLabel, updateLabel,
    clearLabels, saveToFile, loadFromFile,
  } = useLabels();

  const {
    playState, currentTime, duration: playerDuration,
    loadFile: loadAudio, play, pause, seek, unload: unloadAudio,
  } = useAudioPlayer();

  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);

  const audioPathRef = useRef<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // ── 峰值刷新 ──────────────────────────────────────────────────────────────

  const refreshPeaks = useCallback(async () => {
    const container = containerRef.current;
    if (!container || !audioInfo) return;
    const dpr = window.devicePixelRatio || 1;
    const pixelWidth = Math.floor(container.clientWidth * dpr);
    if (pixelWidth <= 0) return;
    const data = await fetchPeaks(pixelWidth);
    if (data) setPeaks(data);
  }, [audioInfo, fetchPeaks]);

  useEffect(() => { refreshPeaks(); }, [refreshPeaks]);

  useEffect(() => {
    const ro = new ResizeObserver(() => {
      if (containerRef.current) setContainerWidth(containerRef.current.clientWidth);
      refreshPeaks();
    });
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [refreshPeaks]);

  // ── 播放头跟随 ─────────────────────────────────────────────────────────────

  useEffect(() => {
    if (playState !== "playing") return;
    const dur = viewRange.endSec - viewRange.startSec;
    if (currentTime > viewRange.endSec) {
      setViewRange({ startSec: currentTime, endSec: currentTime + dur });
    }
    if (currentTime < viewRange.startSec) {
      setViewRange({ startSec: currentTime, endSec: currentTime + dur });
    }
  }, [currentTime, playState, viewRange, setViewRange]);

  // ── 文件操作 ──────────────────────────────────────────────────────────────

  const handleOpenAudio = useCallback(async () => {
    const path = await open({
      multiple: false,
      filters: [
        { name: "音频文件", extensions: ["mp3", "wav", "flac", "m4a", "ogg", "aac"] },
        { name: "全部文件", extensions: ["*"] },
      ],
    });
    if (typeof path !== "string") return;
    audioPathRef.current = path;
    setPeaks(null);
    clearLabels();
    unloadAudio();
    await Promise.all([loadWaveform(path), loadAudio(path)]);
  }, [loadWaveform, loadAudio, clearLabels, unloadAudio]);

  const handleSaveLabels = useCallback(async () => {
    const path = await save({
      defaultPath: "labels.txt",
      filters: [{ name: "Labels", extensions: ["txt"] }],
    });
    if (typeof path === "string") await saveToFile(path);
  }, [saveToFile]);

  const handleLoadLabels = useCallback(async () => {
    const path = await open({
      multiple: false,
      filters: [{ name: "Labels", extensions: ["txt"] }],
    });
    if (typeof path === "string") await loadFromFile(path);
  }, [loadFromFile]);

  // ── 波形交互 ──────────────────────────────────────────────────────────────

  const handleSeek = useCallback((sec: number) => seek(sec), [seek]);

  const handleRegionSelected = useCallback(
    (start: number, end: number) => addLabel(start, end),
    [addLabel]
  );

  const handleZoom = useCallback(
    (delta: number, centerSec: number) => {
      if (delta > 0) zoomIn(centerSec);
      else zoomOut(centerSec);
    },
    [zoomIn, zoomOut]
  );

  const handleJumpTo = useCallback(
    (start: number, end: number) => {
      const pad = (end - start) * 0.2;
      setViewRange({ startSec: Math.max(0, start - pad), endSec: end + pad });
      seek(start);
    },
    [setViewRange, seek]
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const path = (file as unknown as { path?: string }).path ?? file.name;
      audioPathRef.current = path;
      setPeaks(null);
      clearLabels();
      unloadAudio();
      await Promise.all([loadWaveform(path), loadAudio(path)]);
    },
    [loadWaveform, loadAudio, clearLabels, unloadAudio]
  );

  // ── 导出 ──────────────────────────────────────────────────────────────────

  const handleExport = useCallback(async () => {
    if (!audioPathRef.current || labels.length === 0) return;

    const zipPath = await save({
      defaultPath: "listening_pack.zip",
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    if (typeof zipPath !== "string") return;

    const labelData = labels.map((l) => ({ start: l.start, end: l.end, text: l.text }));
    setExportProgress({ step: "splitting", transcribed: 0, total: labels.length });

    try {
      const tmpDir = await getTempDir();
      const segmentPaths = await splitAudio(audioPathRef.current, labelData, tmpDir);

      setExportProgress({ step: "transcribing", transcribed: 0, total: segmentPaths.length });
      const transcriptions: string[] = [];

      for (let i = 0; i < segmentPaths.length; i++) {
        const results = await transcribeSegments([segmentPaths[i]]);
        transcriptions.push(results[0] ?? "");
        setExportProgress({ step: "transcribing", transcribed: i + 1, total: segmentPaths.length });
      }

      setExportProgress({ step: "zipping", transcribed: transcriptions.length, total: transcriptions.length });
      await buildZip(segmentPaths, labelData, transcriptions, zipPath);

      setExportProgress({
        step: "done",
        transcribed: transcriptions.length,
        total: transcriptions.length,
        outputPath: zipPath,
      });
    } catch (err) {
      setExportProgress((prev) => ({ ...prev!, step: "error", errorMsg: String(err) }));
    }
  }, [labels]);

  const isPlaying = playState === "playing";

  return (
    <div
      style={s.root}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <AnnotateToolbar
        audioInfo={audioInfo}
        loadingState={loadingState}
        labelCount={labels.length}
        currentTime={currentTime}
        playing={isPlaying}
        onBack={onBack}
        onOpenAudio={handleOpenAudio}
        onSaveLabels={handleSaveLabels}
        onLoadLabels={handleLoadLabels}
        onClearLabels={clearLabels}
        onPlay={() => play()}
        onPause={pause}
        onExport={handleExport}
      />

      {/* 波形区 */}
      <div ref={containerRef} style={s.waveArea}>
        {loadingState === "idle" && (
          <EmptyState
            icon="♪"
            title="拖入音频文件，或点击「打开音频」"
            hint="支持 MP3 · WAV · FLAC · M4A · OGG · AAC"
          />
        )}
        {loadingState === "decoding" && (
          <EmptyState spinner title="解码中，请稍候…" />
        )}
        {(loadingState === "ready" || peaks !== null) && (
          <WaveformCanvas
            peaks={peaks}
            viewRange={viewRange}
            duration={audioInfo?.duration ?? 0}
            playhead={currentTime}
            labels={labels}
            onSeek={handleSeek}
            onRegionSelected={handleRegionSelected}
            onZoom={handleZoom}
            onScroll={scrollBy}
          />
        )}
      </div>

      {/* 时间轴 */}
      {loadingState === "ready" && (
        <TimeAxis viewRange={viewRange} width={containerWidth} />
      )}

      {/* 标注列表 */}
      <LabelList
        labels={labels}
        duration={audioInfo?.duration ?? 0}
        onRemove={removeLabel}
        onJumpTo={handleJumpTo}
        onUpdateText={(id, text) => updateLabel(id, { text })}
      />

      {/* 导出进度 */}
      {exportProgress && (
        <ExportPanel
          progress={exportProgress}
          onClose={() => setExportProgress(null)}
          onReveal={(path) => {
            import("@tauri-apps/api/core").then(({ invoke }) =>
              invoke("reveal_in_finder", { path }).catch(console.warn)
            );
          }}
        />
      )}
    </div>
  );
}

function EmptyState({ icon, title, hint, spinner }: {
  icon?: string; title: string; hint?: string; spinner?: boolean;
}) {
  return (
    <div style={{
      position: "absolute", inset: 0,
      display: "flex", flexDirection: "column",
      alignItems: "center", justifyContent: "center", gap: 8,
    }}>
      {spinner ? (
        <div style={{
          width: 22, height: 22,
          border: `2px solid ${C.border}`,
          borderTop: `2px solid ${C.blue}`,
          borderRadius: "50%",
          animation: "spin 0.8s linear infinite",
          marginBottom: 4,
        }} />
      ) : (
        <div style={{ fontSize: 32, color: C.border2, lineHeight: 1, marginBottom: 4 }}>{icon}</div>
      )}
      <p style={{ fontSize: 14, color: C.ink3, fontWeight: 500 }}>{title}</p>
      {hint && <p style={{ fontSize: 12, color: C.border2 }}>{hint}</p>}
    </div>
  );
}

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
  // 波形区撑满剩余高度，最小保留 160px 防止过度压缩
  waveArea: {
    flex: 1,
    minHeight: 160,
    position: "relative",
    overflow: "hidden",
    background: C.paper,
    borderBottom: `0.5px solid ${C.border}`,
  },
};