import { useState, useEffect, useRef, useCallback } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { WaveformCanvas } from "./WaveformCanvas";
import { LabelList } from "./LabelList";
import { Toolbar } from "./Toolbar";
import { PlayerBar } from "./PlayerBar";
import { ExportPanel, type ExportProgress } from "./ExportPanel";
import { useWaveform } from "@/hooks/useWaveform";
import { useLabels } from "@/hooks/useLabels";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import {
  splitAudio,
  transcribeSegments,
  buildZip,
  getTempDir,
} from "@/utils/tauriApi";

export function WaveformEditor() {
  const {
    audioInfo,
    loadingState,
    viewRange,
    loadFile: loadWaveform,
    fetchPeaks,
    setViewRange,
    zoomIn,
    zoomOut,
    zoomReset,
    scrollBy,
  } = useWaveform();

  const {
    labels,
    addLabel,
    removeLabel,
    updateLabel,
    clearLabels,
    saveToFile,
    loadFromFile,
  } = useLabels();

  const {
    playState,
    currentTime,
    duration: playerDuration,
    loadFile: loadAudio,
    play,
    pause,
    seek,
    unload: unloadAudio,
  } = useAudioPlayer();

  const [peaks, setPeaks] = useState<Float32Array | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);

  // 当前加载的音频文件路径（用于导出时切割）
  const audioPathRef = useRef<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // ── 峰值刷新 ────────────────────────────────────────────────────────────────
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
    const ro = new ResizeObserver(() => refreshPeaks());
    if (containerRef.current) ro.observe(containerRef.current);
    return () => ro.disconnect();
  }, [refreshPeaks]);

  // ── 播放头跟随 ───────────────────────────────────────────────────────────────
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

  // ── 文件操作 ─────────────────────────────────────────────────────────────────
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

  // ── 波形交互 ─────────────────────────────────────────────────────────────────
  const handleSeek = useCallback((sec: number) => {
    seek(sec);
  }, [seek]);

  const handleRegionSelected = useCallback((start: number, end: number) => {
    addLabel(start, end);
  }, [addLabel]);

  const handleZoom = useCallback((delta: number, centerSec: number) => {
    if (delta > 0) zoomIn(centerSec);
    else zoomOut(centerSec);
  }, [zoomIn, zoomOut]);

  const handleJumpTo = useCallback((start: number, end: number) => {
    const pad = (end - start) * 0.2;
    setViewRange({
      startSec: Math.max(0, start - pad),
      endSec: end + pad,
    });
    seek(start);
  }, [setViewRange, seek]);

  const handleDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (!file) return;
    const path = (file as unknown as { path?: string }).path ?? file.name;
    audioPathRef.current = path;
    setPeaks(null);
    clearLabels();
    unloadAudio();
    await Promise.all([loadWaveform(path), loadAudio(path)]);
  }, [loadWaveform, loadAudio, clearLabels, unloadAudio]);

  // ── 导出数据包 ────────────────────────────────────────────────────────────────
  const handleExportPackage = useCallback(async () => {
    if (!audioPathRef.current || labels.length === 0) return;

    const zipPath = await save({
      defaultPath: "listening_pack.zip",
      filters: [{ name: "ZIP 压缩包", extensions: ["zip"] }],
    });
    if (typeof zipPath !== "string") return;

    const labelData = labels.map((l) => ({
      start: l.start,
      end: l.end,
      text: l.text,
    }));

    setExportProgress({ step: "splitting", transcribed: 0, total: labels.length });

    try {
      // 1. 切割音频
      const tmpDir = await getTempDir();
      const segmentPaths = await splitAudio(audioPathRef.current, labelData, tmpDir);

      // 2. Whisper 转写（逐条更新进度）
      setExportProgress({ step: "transcribing", transcribed: 0, total: segmentPaths.length });
      const transcriptions: string[] = [];

      // 分批调用，每次转写一个，更新进度
      for (let i = 0; i < segmentPaths.length; i++) {
        const results = await transcribeSegments([segmentPaths[i]]);
        transcriptions.push(results[0] ?? "");
        setExportProgress({
          step: "transcribing",
          transcribed: i + 1,
          total: segmentPaths.length,
        });
      }

      // 3. 打包
      setExportProgress({ step: "zipping", transcribed: transcriptions.length, total: transcriptions.length });
      await buildZip(segmentPaths, labelData, transcriptions, zipPath);

      setExportProgress({ step: "done", transcribed: transcriptions.length, total: transcriptions.length, outputPath: zipPath });
    } catch (err) {
      setExportProgress((prev) => ({
        ...prev!,
        step: "error",
        errorMsg: String(err),
      }));
    }
  }, [labels]);

  return (
    <div
      style={styles.root}
      onDragOver={(e) => e.preventDefault()}
      onDrop={handleDrop}
    >
      <Toolbar
        audioInfo={audioInfo}
        loadingState={loadingState}
        labelCount={labels.length}
        playhead={currentTime}
        onOpenAudio={handleOpenAudio}
        onSaveLabels={handleSaveLabels}
        onLoadLabels={handleLoadLabels}
        onClearLabels={clearLabels}
        onExportPackage={handleExportPackage}
        onZoomIn={() => zoomIn()}
        onZoomOut={() => zoomOut()}
        onZoomReset={zoomReset}
      />

      {/* 波形区域 */}
      <div ref={containerRef} style={styles.waveArea}>
        {loadingState === "idle" && (
          <div style={styles.empty}>
            <div style={styles.emptyIcon}>♪</div>
            <p style={styles.emptyTitle}>拖入音频文件，或点击「打开音频」</p>
            <p style={styles.emptyHint}>支持 MP3 · WAV · FLAC · M4A · OGG</p>
          </div>
        )}
        {loadingState === "decoding" && (
          <div style={styles.empty}>
            <div style={styles.spinner} />
            <p style={styles.emptyTitle}>解码中，请稍候…</p>
          </div>
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

      {/* 播放控制栏 */}
      <PlayerBar
        playState={playState}
        currentTime={currentTime}
        duration={playerDuration}
        onPlay={() => play()}
        onPause={pause}
        onSeek={seek}
      />

      {/* 标记列表 */}
      <LabelList
        labels={labels}
        duration={audioInfo?.duration ?? 0}
        onRemove={removeLabel}
        onJumpTo={handleJumpTo}
        onUpdateText={(id, text) => updateLabel(id, { text })}
      />

      {/* 导出进度弹窗 */}
      {exportProgress && (
        <ExportPanel
          progress={exportProgress}
          onClose={() => setExportProgress(null)}
          onReveal={(path) => {
            // Tauri shell 打开 Finder（在 commands 里实现 reveal_in_finder）
            import("@tauri-apps/api/core").then(({ invoke }) =>
              invoke("reveal_in_finder", { path }).catch(console.warn)
            );
          }}
        />
      )}
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100vw",
    height: "100vh",
    background: "#F8FAFF",
    overflow: "hidden",
    userSelect: "none",
  },
  waveArea: {
    flex: 1,
    position: "relative",
    overflow: "hidden",
    background: "#F8FAFF",
  },
  empty: {
    position: "absolute",
    inset: 0,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: 8,
  },
  emptyIcon: {
    fontSize: 36,
    color: "#CBD5E1",
    marginBottom: 4,
    lineHeight: 1,
  },
  emptyTitle: {
    fontSize: 15,
    color: "#94A3B8",
    margin: 0,
    fontWeight: 500,
  },
  emptyHint: {
    fontSize: 12,
    color: "#CBD5E1",
    margin: 0,
  },
  spinner: {
    width: 24,
    height: 24,
    border: "2px solid #E2E8F0",
    borderTop: "2px solid #2563EB",
    borderRadius: "50%",
    animation: "spin 0.8s linear infinite",
    marginBottom: 8,
  },
};