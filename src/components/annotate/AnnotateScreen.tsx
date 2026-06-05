import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { open, save } from "@tauri-apps/plugin-dialog";
import { AnnotateToolbar } from "./AnnotateToolbar";
import { WaveformCanvas } from "./WaveformCanvas";
import { TimeAxis } from "./TimeAxis";
import { LabelList } from "./LabelList";
import { ExportPanel, type ExportProgress } from "./ExportPanel";
import { ShortcutModal } from "./ShortcutModal";
import { useWaveform } from "@/hooks/useWaveform";
import { useLabels } from "@/hooks/useLabels";
import { useAudioPlayer } from "@/hooks/useAudioPlayer";
import { splitAudio, transcribeSegments, buildZip, getTempDir } from "@/utils/tauriApi";
import type { Label, RenderData } from "@/types/waveform";

interface AnnotateScreenProps {
  onBack: () => void;
}

// 加载后初始视图分辨率：每秒约占 50 CSS px。窗口越宽 → 一屏看到的秒数越多，
// 但单句的像素宽度保持稳定，便于拖拽框选。整曲短于此跨度时退化为显示全曲。
const FIT_PX_PER_SEC = 50;

export function AnnotateScreen({ onBack }: AnnotateScreenProps) {
  const {
    audioInfo,
    loadingState,
    viewRange,
    loadFile: loadWaveform,
    fetchPeaks,
    setViewRange,
    zoomIn,
    zoomOut,
    scrollBy,
  } = useWaveform();

  const { labels, addLabel, removeLabel, updateLabel, clearLabels, saveToFile, loadFromFile } =
    useLabels();

  const {
    playState,
    currentTime,
    loopRange,
    load: loadAudio,
    play,
    playSegment,
    pause,
    seek,
    unload: unloadAudio,
    setLoop,
  } = useAudioPlayer();

  const [renderData, setRenderData] = useState<RenderData | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showHelp, setShowHelp] = useState(false);

  const audioPathRef = useRef<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // 按起点排序的片段，供 ←/→ 片段间导航使用
  const sortedLabels = useMemo<Label[]>(
    () => [...labels].sort((a, b) => a.start - b.start),
    [labels],
  );

  // 重叠检测：O(n²)，label 数量通常 < 200 完全可接受
  const overlappingIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i],
          b = labels[j];
        if (a.start < b.end && a.end > b.start) {
          ids.add(a.id);
          ids.add(b.id);
        }
      }
    }
    return ids;
  }, [labels]);

  // ── 峰值刷新 ──────────────────────────────────────────────────────────────

  const rafIdRef = useRef<number>(0);
  const reqIdRef = useRef<number>(0);

  const refreshPeaks = useCallback(() => {
    if (rafIdRef.current) return;
    rafIdRef.current = requestAnimationFrame(async () => {
      rafIdRef.current = 0;
      const container = containerRef.current;
      if (!container || !audioInfo) return;
      const dpr = window.devicePixelRatio || 1;
      const pixelWidth = Math.floor(container.clientWidth * dpr);
      if (pixelWidth <= 0) return;

      const myReqId = ++reqIdRef.current;
      const data = await fetchPeaks(pixelWidth);
      if (myReqId !== reqIdRef.current) return;

      if (data) {
        if (process.env.NODE_ENV !== "production") {
          const ch0 = data.channels[0];
          const len =
            ch0?.kind === "envelope"
              ? ch0.peaks.length
              : ch0?.kind === "polyline" || ch0?.kind === "stem"
                ? ch0.points.length
                : 0;
          const dur = viewRange.endSec - viewRange.startSec;
          const spp = (dur * (audioInfo?.sampleRate ?? 22050)) / pixelWidth;
          console.log(
            `[waveform] mode=${data.mode} channels=${data.channels.length} ` +
              `len=${len} pixelWidth=${pixelWidth} spp=${spp.toFixed(2)} dur=${dur.toFixed(3)}s`,
          );
        }
        setRenderData(data);
      }
    });
  }, [audioInfo, fetchPeaks, viewRange]);

  useEffect(() => {
    return () => {
      if (rafIdRef.current) {
        cancelAnimationFrame(rafIdRef.current);
        rafIdRef.current = 0;
      }
    };
  }, []);

  useEffect(() => {
    refreshPeaks();
  }, [refreshPeaks]);

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

  // 按当前窗口宽度算出"适合的初始视图"：每秒约 FIT_PX_PER_SEC px。
  // 在 loadFile 内一次性应用，避免先渲染整曲再 snap 的闪烁。
  const computeFitView = useCallback((duration: number) => {
    const w = containerRef.current?.clientWidth ?? 0;
    const span = w > 0 ? w / FIT_PX_PER_SEC : duration;
    return { startSec: 0, endSec: Math.min(span, duration) };
  }, []);

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
    setRenderData(null);
    clearLabels();
    unloadAudio();
    setLoop(null);
    await Promise.all([loadWaveform(path, computeFitView), loadAudio(path)]);
  }, [loadWaveform, loadAudio, clearLabels, unloadAudio, setLoop, computeFitView]);

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
    (start: number, end: number) => {
      const label = addLabel(start, end);
      setSelectedId(label.id);
      // 拖完自动开回环，立刻进入精听节奏
      setLoop([start, end]);
      seek(start);
      play(start);
    },
    [addLabel, setLoop, seek, play],
  );

  const handleZoom = useCallback(
    (delta: number, centerSec: number) => {
      if (delta > 0) zoomIn(centerSec);
      else zoomOut(centerSec);
    },
    [zoomIn, zoomOut],
  );

  const handleJumpTo = useCallback(
    (start: number, end: number) => {
      const pad = (end - start) * 0.2;
      setViewRange({ startSec: Math.max(0, start - pad), endSec: end + pad });
      seek(start);
    },
    [setViewRange, seek],
  );

  // 选中片段并播放（回环则换 loop 区间，否则播一段自动停）。
  // pan=true：仅当片段超出当前视图时平移过去，保持缩放级别不变（不改变分辨率）。
  const selectLabel = useCallback(
    (label: Label, pan: boolean) => {
      setSelectedId(label.id);
      if (pan) {
        const dur = viewRange.endSec - viewRange.startSec;
        if (label.start < viewRange.startSec || label.end > viewRange.endSec) {
          const segDur = label.end - label.start;
          const newStart = Math.max(0, label.start - (dur - segDur) / 2);
          setViewRange({ startSec: newStart, endSec: newStart + dur });
        }
      }
      if (loopRange) {
        setLoop([label.start, label.end]);
        seek(label.start);
        play(label.start);
      } else {
        playSegment(label.start, label.end);
      }
    },
    [viewRange, loopRange, setLoop, seek, play, playSegment, setViewRange],
  );

  // ←/→ 片段间导航：有选中按序号 ±1；无选中则跳到 playhead 之后/之前最近的一段。
  const navigateSegment = useCallback(
    (dir: 1 | -1) => {
      if (sortedLabels.length === 0) return;
      const curIdx = sortedLabels.findIndex((l) => l.id === selectedId);
      let target: Label | undefined;
      if (curIdx !== -1) {
        const ni = curIdx + dir;
        if (ni < 0 || ni >= sortedLabels.length) return;
        target = sortedLabels[ni];
      } else if (dir === 1) {
        target = sortedLabels.find((l) => l.start > currentTime + 0.01);
      } else {
        for (let i = sortedLabels.length - 1; i >= 0; i--) {
          if (sortedLabels[i].start < currentTime - 0.01) {
            target = sortedLabels[i];
            break;
          }
        }
      }
      if (target) selectLabel(target, true);
    },
    [sortedLabels, selectedId, currentTime, selectLabel],
  );

  // 边缘拖拽
  const handleLabelEdgeDrag = useCallback(
    (id: string, edge: "start" | "end", newSec: number) => {
      const label = labels.find((l) => l.id === id);
      if (!label) return;
      const clamped = Math.max(0, Math.min(newSec, audioInfo?.duration ?? Infinity));
      const isLooping = loopRange !== null && selectedId === id;
      if (edge === "start") {
        const newStart = Math.min(clamped, label.end - 0.05);
        updateLabel(id, { start: newStart });
        if (isLooping) setLoop([newStart, label.end]);
      } else {
        const newEnd = Math.max(clamped, label.start + 0.05);
        updateLabel(id, { end: newEnd });
        if (isLooping) setLoop([label.start, newEnd]);
      }
    },
    [labels, updateLabel, audioInfo, loopRange, selectedId, setLoop],
  );

  const handleDrop = useCallback(
    async (e: React.DragEvent) => {
      e.preventDefault();
      const file = e.dataTransfer.files[0];
      if (!file) return;
      const path = (file as unknown as { path?: string }).path ?? file.name;
      audioPathRef.current = path;
      setRenderData(null);
      clearLabels();
      unloadAudio();
      setLoop(null);
      await Promise.all([loadWaveform(path, computeFitView), loadAudio(path)]);
    },
    [loadWaveform, loadAudio, clearLabels, unloadAudio, setLoop, computeFitView],
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

      setExportProgress({
        step: "zipping",
        transcribed: transcriptions.length,
        total: transcriptions.length,
      });
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

  // ── 键盘快捷键 ────────────────────────────────────────────────────────────
  //
  // 空格    播放/暂停
  // L      切换回环播放（当前时间所在/最近的 label）
  // ←/→   上一段 / 下一段（片段间导航，保持缩放只平移）
  // H      显示/隐藏快捷键帮助
  //
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (e.repeat) return;

      const el = document.activeElement as HTMLElement | null;
      const inEditable =
        el?.tagName === "INPUT" || el?.tagName === "TEXTAREA" || el?.isContentEditable === true;
      if (inEditable) return;

      // H：显示 / 隐藏快捷键帮助
      if (e.key === "h" || e.key === "H") {
        e.preventDefault();
        setShowHelp((v) => !v);
        return;
      }

      // Esc：关闭帮助弹窗
      if (e.key === "Escape") {
        setShowHelp(false);
        return;
      }

      // 空格：播放/暂停（聚焦在按钮上时让位给按钮的点击）
      if (e.key === " " || e.code === "Space") {
        if (el?.tagName === "BUTTON") return;
        if (loadingState !== "ready") return;
        e.preventDefault();
        if (playState === "playing") pause();
        else play();
        return;
      }

      // L：切换回环播放
      if (e.key === "l" || e.key === "L") {
        if (loadingState !== "ready") return;
        e.preventDefault();

        if (loopRange !== null) {
          setLoop(null);
          return;
        }

        const target =
          labels.find((lb) => currentTime >= lb.start && currentTime <= lb.end) ??
          labels.reduce<(typeof labels)[0] | null>((best, lb) => {
            if (!best) return lb;
            const distA = Math.min(
              Math.abs(currentTime - best.start),
              Math.abs(currentTime - best.end),
            );
            const distB = Math.min(
              Math.abs(currentTime - lb.start),
              Math.abs(currentTime - lb.end),
            );
            return distB < distA ? lb : best;
          }, null);

        if (!target) return;
        setLoop([target.start, target.end]);
        seek(target.start);
        play(target.start);
        return;
      }

      // ←/→：上一段 / 下一段
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (loadingState !== "ready") return;
        e.preventDefault();
        navigateSegment(e.key === "ArrowRight" ? 1 : -1);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    playState,
    play,
    pause,
    loadingState,
    navigateSegment,
    currentTime,
    labels,
    loopRange,
    setLoop,
    seek,
  ]);

  return (
    <div style={s.root} onDragOver={(e) => e.preventDefault()} onDrop={handleDrop}>
      <AnnotateToolbar
        audioInfo={audioInfo}
        loadingState={loadingState}
        labelCount={labels.length}
        currentTime={currentTime}
        playing={isPlaying}
        looping={loopRange !== null}
        onBack={onBack}
        onShowHelp={() => setShowHelp(true)}
        onOpenAudio={handleOpenAudio}
        onSaveLabels={handleSaveLabels}
        onLoadLabels={handleLoadLabels}
        onClearLabels={() => {
          setLoop(null);
          clearLabels();
        }}
        onPlay={() => play()}
        onPause={pause}
        onExport={handleExport}
        onToggleLoop={() => {
          if (loopRange) setLoop(null);
          else {
            // 找当前时间所在 label
            const target =
              labels.find((lb) => currentTime >= lb.start && currentTime <= lb.end) ??
              labels[labels.length - 1];
            if (target) {
              setLoop([target.start, target.end]);
              seek(target.start);
              play(target.start);
            }
          }
        }}
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
        {loadingState === "decoding" && <EmptyState spinner title="解码中，请稍候…" />}
        {(loadingState === "ready" || renderData !== null) && (
          <WaveformCanvas
            data={renderData}
            viewRange={viewRange}
            duration={audioInfo?.duration ?? 0}
            playhead={currentTime}
            colors={{ playhead: "#16A34A" }}
            labels={labels}
            selectedId={selectedId}
            overlappingIds={overlappingIds}
            loopRange={loopRange}
            onSeek={handleSeek}
            onRegionSelected={handleRegionSelected}
            onZoom={handleZoom}
            onScroll={scrollBy}
            onLabelEdgeDrag={handleLabelEdgeDrag}
          />
        )}
      </div>

      {/* 时间轴 */}
      {loadingState === "ready" && <TimeAxis viewRange={viewRange} width={containerWidth} />}

      {/* 标注列表 */}
      <LabelList
        labels={labels}
        duration={audioInfo?.duration ?? 0}
        selectedId={selectedId}
        overlappingIds={overlappingIds}
        onSelect={(id) => {
          // 点击卡片：仅选中并播放，不改动视图缩放（定位视图请用卡片上的「定位」按钮）
          const label = labels.find((l) => l.id === id);
          if (label) selectLabel(label, false);
        }}
        onRemove={(id) => {
          const label = labels.find((l) => l.id === id);
          // 若正在循环的恰是被删片段，清掉回环：去掉高亮背景，让播放正常走下去
          if (label && loopRange && loopRange[0] === label.start && loopRange[1] === label.end) {
            setLoop(null);
          }
          removeLabel(id);
          if (selectedId === id) setSelectedId(null);
        }}
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
              invoke("reveal_in_finder", { path }).catch(console.warn),
            );
          }}
        />
      )}

      {/* 快捷键帮助弹窗 */}
      {showHelp && <ShortcutModal onClose={() => setShowHelp(false)} />}
    </div>
  );
}

// ── In 点指示器 ───────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

function EmptyState({
  icon,
  title,
  hint,
  spinner,
}: {
  icon?: string;
  title: string;
  hint?: string;
  spinner?: boolean;
}) {
  return (
    <div
      style={{
        position: "absolute",
        inset: 0,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: 8,
      }}
    >
      {spinner ? (
        <div
          style={{
            width: 22,
            height: 22,
            border: `2px solid var(--color-border)`,
            borderTop: `2px solid var(--color-brand)`,
            borderRadius: "50%",
            animation: "spin 0.8s linear infinite",
            marginBottom: 4,
          }}
        />
      ) : (
        <div
          style={{ fontSize: 32, color: "var(--color-border-2)", lineHeight: 1, marginBottom: 4 }}
        >
          {icon}
        </div>
      )}
      <p style={{ fontSize: 14, color: "var(--color-ink-3)", fontWeight: 500 }}>{title}</p>
      {hint && <p style={{ fontSize: 12, color: "var(--color-border-2)" }}>{hint}</p>}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  root: {
    display: "flex",
    flexDirection: "column",
    width: "100vw",
    height: "100vh",
    background: "var(--color-paper-2)",
    overflow: "hidden",
    userSelect: "none",
  },
  waveArea: {
    flex: 1,
    minHeight: 160,
    position: "relative",
    overflow: "hidden",
    background: "var(--color-paper)",
    borderBottom: `0.5px solid var(--color-border)`,
  },
};
