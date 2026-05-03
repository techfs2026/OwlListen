import React, { useState, useEffect, useRef, useCallback, useMemo } from "react";
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
import { splitAudio, transcribeSegments, buildZip, getTempDir, getPeaks } from "@/utils/tauriApi";
import type { RenderData } from "@/types/waveform";
import type { SilenceRegion } from "@/hooks/useWebGL";

interface AnnotateScreenProps {
  onBack: () => void;
}

// ── 静音检测 ──────────────────────────────────────────────────────────────────

const SILENCE_RATIO = 0.15;      // 低于中位数 RMS × 15% 视为静音
const MIN_SILENCE_SEC = 0.1;     // 静音区间最短 100ms，过滤噪点

/**
 * 从全曲 Envelope peaks（已映射到绝对时间）计算静音区间列表（秒）。
 * 输入 peaks 对应 [0, duration]，n 个点均匀分布。
 */
function computeAbsSilenceRegions(
  peaks: Array<{ rms: number }>,
  duration: number,
): Array<{ start: number; end: number }> {
  const n = peaks.length;
  if (n === 0) return [];

  const rmsSorted = peaks.map((p) => p.rms).sort((a, b) => a - b);
  const median = rmsSorted[Math.floor(n / 2)];
  const threshold = median * SILENCE_RATIO;

  const regions: Array<{ start: number; end: number }> = [];
  let silStart = -1;

  for (let i = 0; i <= n; i++) {
    const isSilent = i < n && peaks[i].rms <= threshold;
    if (isSilent && silStart === -1) {
      silStart = i;
    } else if (!isSilent && silStart !== -1) {
      const start = (silStart / n) * duration;
      const end   = (i / n) * duration;
      if (end - start >= MIN_SILENCE_SEC) {
        regions.push({ start, end });
      }
      silStart = -1;
    }
  }
  return regions;
}

// ─────────────────────────────────────────────────────────────────────────────

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
    loopRange,
    load: loadAudio, play, pause, seek, unload: unloadAudio, setLoop,
  } = useAudioPlayer();

  const [renderData, setRenderData] = useState<RenderData | null>(null);
  const [exportProgress, setExportProgress] = useState<ExportProgress | null>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  // 全曲绝对时间静音区间，文件加载后一次性计算，与视图无关
  const [absSilenceRegions, setAbsSilenceRegions] = useState<Array<{ start: number; end: number }>>([]);

  const audioPathRef = useRef<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // 当前视图的归一化静音条带（仅用于 WebGL 渲染）
  // 从绝对时间区间换算，与 renderData.mode 无关——放大到 polyline/stem 也能显示
  const silenceRegions = useMemo<SilenceRegion[]>(() => {
    if (absSilenceRegions.length === 0) return [];
    const { startSec, endSec } = viewRange;
    const viewDur = endSec - startSec;
    if (viewDur <= 0) return [];
    return absSilenceRegions
      .filter((r) => r.end > startSec && r.start < endSec)
      .map((r) => ({
        startRatio: Math.max(0, (r.start - startSec) / viewDur),
        endRatio:   Math.min(1, (r.end   - startSec) / viewDur),
      }));
  }, [absSilenceRegions, viewRange]);

  // 重叠检测：O(n²)，label 数量通常 < 200 完全可接受
  const overlappingIds = useMemo<Set<string>>(() => {
    const ids = new Set<string>();
    for (let i = 0; i < labels.length; i++) {
      for (let j = i + 1; j < labels.length; j++) {
        const a = labels[i], b = labels[j];
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
            ch0?.kind === "envelope" ? ch0.peaks.length :
            ch0?.kind === "polyline" || ch0?.kind === "stem" ? ch0.points.length : 0;
          const dur = viewRange.endSec - viewRange.startSec;
          const spp = (dur * (audioInfo?.sampleRate ?? 22050)) / pixelWidth;
          console.log(
            `[waveform] mode=${data.mode} channels=${data.channels.length} ` +
            `len=${len} pixelWidth=${pixelWidth} spp=${spp.toFixed(2)} dur=${dur.toFixed(3)}s`
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
    setRenderData(null);
    clearLabels();
    unloadAudio();
    setLoop(null);
    setAbsSilenceRegions([]);
    await Promise.all([loadWaveform(path), loadAudio(path)]);
  }, [loadWaveform, loadAudio, clearLabels, unloadAudio, setLoop]);

  // 全曲静音分析：loadingState 变为 ready 时触发一次
  // 直接调 getPeaks(0, duration, 1200)，不经过 fetchPeaks（后者绑定当前 viewRange）
  useEffect(() => {
    if (loadingState !== "ready" || !audioInfo) return;
    let cancelled = false;
    (async () => {
      try {
        const data = await getPeaks(0, audioInfo.duration, 1200);
        if (cancelled || !data || data.mode !== "envelope") return;
        const ch = data.channels[0];
        if (ch?.kind !== "envelope") return;
        const regions = computeAbsSilenceRegions(ch.peaks, audioInfo.duration);
        setAbsSilenceRegions(regions);
        if (process.env.NODE_ENV !== "production") {
          console.log(`[silence] ${regions.length} regions, duration=${audioInfo.duration.toFixed(1)}s`);
        }
      } catch (err) {
        console.warn("[silence] analysis failed:", err);
      }
    })();
    return () => { cancelled = true; };
  }, [loadingState, audioInfo]);

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

  // 边界吸附：把 sec 吸到最近的静音边缘，阈值 = 视图时长 × 1%
  const snapToSilence = useCallback((sec: number): number => {
    if (absSilenceRegions.length === 0) return sec;
    const threshold = (viewRange.endSec - viewRange.startSec) * 0.01;
    let best = sec;
    let bestDist = threshold;
    for (const r of absSilenceRegions) {
      const ds = Math.abs(sec - r.start);
      const de = Math.abs(sec - r.end);
      if (ds < bestDist) { bestDist = ds; best = r.start; }
      if (de < bestDist) { bestDist = de; best = r.end; }
    }
    return best;
  }, [absSilenceRegions, viewRange]);

  const handleRegionSelected = useCallback(
    (start: number, end: number) => {
      const snappedStart = snapToSilence(start);
      const snappedEnd   = snapToSilence(end);
      const label = addLabel(snappedStart, snappedEnd);
      setSelectedId(label.id);
      // 拖完自动开回环，立刻进入精听节奏
      setLoop([snappedStart, snappedEnd]);
      seek(snappedStart);
      play(snappedStart);
    },
    [addLabel, snapToSilence, setLoop, seek, play]
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

  // 边缘拖拽 + 吸附
  const handleLabelEdgeDrag = useCallback(
    (id: string, edge: "start" | "end", newSec: number) => {
      const label = labels.find((l) => l.id === id);
      if (!label) return;
      const clamped = Math.max(0, Math.min(newSec, audioInfo?.duration ?? Infinity));
      const snapped = snapToSilence(clamped);
      if (edge === "start") {
        const newStart = Math.min(snapped, label.end - 0.05);
        updateLabel(id, { start: newStart });
      } else {
        const newEnd = Math.max(snapped, label.start + 0.05);
        updateLabel(id, { end: newEnd });
      }
    },
    [labels, updateLabel, audioInfo, snapToSilence]
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
      setAbsSilenceRegions([]);
      await Promise.all([loadWaveform(path), loadAudio(path)]);
    },
    [loadWaveform, loadAudio, clearLabels, unloadAudio, setLoop]
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

  // ── 键盘快捷键 ────────────────────────────────────────────────────────────
  //
  // P      播放/暂停
  // L      切换回环播放
  // N      跳转到下一个静音区
  // ← / →  切换选中区段（保持缩放，平移视图）
  //
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // ←→ 允许 repeat（按住连续切换）；其余不允许
      const isLR = e.key === "ArrowLeft" || e.key === "ArrowRight";
      if (e.repeat && !isLR) return;

      const el = document.activeElement as HTMLElement | null;
      const inEditable =
        el?.tagName === "INPUT" ||
        el?.tagName === "TEXTAREA" ||
        el?.isContentEditable === true;
      if (inEditable) return;

      // P：播放/暂停
      if (e.key === "p" || e.key === "P") {
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
          labels.reduce<typeof labels[0] | null>((best, lb) => {
            if (!best) return lb;
            const distA = Math.min(Math.abs(currentTime - best.start), Math.abs(currentTime - best.end));
            const distB = Math.min(Math.abs(currentTime - lb.start), Math.abs(currentTime - lb.end));
            return distB < distA ? lb : best;
          }, null);

        if (!target) return;
        setLoop([target.start, target.end]);
        seek(target.start);
        play(target.start);
        return;
      }

      // N：跳转到下一个静音区
      if (e.key === "n" || e.key === "N") {
        if (loadingState !== "ready") return;
        e.preventDefault();

        const next = absSilenceRegions.find((r) => r.start > currentTime + 0.05);
        if (!next) return;

        const dur = viewRange.endSec - viewRange.startSec;
        const newStart = Math.max(0, next.start - dur * 0.3);
        setViewRange({ startSec: newStart, endSec: newStart + dur });
        seek(next.start);
        return;
      }

      // ← / →：切换选中区段，保持当前缩放级别，平移视图使目标区段居中
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (loadingState !== "ready" || labels.length === 0) return;
        e.preventDefault();

        const curIdx = labels.findIndex((l) => l.id === selectedId);
        let nextIdx: number;
        if (curIdx === -1) {
          nextIdx = e.key === "ArrowRight" ? 0 : labels.length - 1;
        } else {
          nextIdx = e.key === "ArrowRight"
            ? Math.min(curIdx + 1, labels.length - 1)
            : Math.max(curIdx - 1, 0);
        }

        const target = labels[nextIdx];
        setSelectedId(target.id);

        // 保持当前视图时长，平移使 target.start 落在视图左侧 25% 处
        const viewDur = viewRange.endSec - viewRange.startSec;
        const newStart = Math.max(0, target.start - viewDur * 0.25);
        setViewRange({ startSec: newStart, endSec: newStart + viewDur });
        seek(target.start);
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    playState, play, pause, loadingState,
    currentTime,
    loopRange, setLoop, labels, seek,
    absSilenceRegions, viewRange, setViewRange,
    selectedId,
  ]);

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
        looping={loopRange !== null}
        onBack={onBack}
        onOpenAudio={handleOpenAudio}
        onSaveLabels={handleSaveLabels}
        onLoadLabels={handleLoadLabels}
        onClearLabels={clearLabels}
        onPlay={() => play()}
        onPause={pause}
        onExport={handleExport}
        onToggleLoop={() => {
          if (loopRange) setLoop(null);
          else {
            // 找当前时间所在 label
            const target = labels.find(
              (lb) => currentTime >= lb.start && currentTime <= lb.end
            ) ?? labels[labels.length - 1];
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
        {loadingState === "decoding" && (
          <EmptyState spinner title="解码中，请稍候…" />
        )}
        {(loadingState === "ready" || renderData !== null) && (
          <WaveformCanvas
            data={renderData}
            viewRange={viewRange}
            duration={audioInfo?.duration ?? 0}
            playhead={currentTime}
            labels={labels}
            selectedId={selectedId}
            overlappingIds={overlappingIds}
            silenceRegions={silenceRegions}
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
      {loadingState === "ready" && (
        <TimeAxis viewRange={viewRange} width={containerWidth} />
      )}

      {/* 标注列表 */}
      <LabelList
        labels={labels}
        duration={audioInfo?.duration ?? 0}
        selectedId={selectedId}
        overlappingIds={overlappingIds}
        onSelect={(id) => {
          setSelectedId(id);
          const label = labels.find((l) => l.id === id);
          if (label) {
            const pad = (label.end - label.start) * 0.2;
            setViewRange({ startSec: Math.max(0, label.start - pad), endSec: label.end + pad });
            seek(label.start);
          }
        }}
        onRemove={(id) => {
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
              invoke("reveal_in_finder", { path }).catch(console.warn)
            );
          }}
        />
      )}
    </div>
  );
}

// ── In 点指示器 ───────────────────────────────────────────────────────────────
// ─────────────────────────────────────────────────────────────────────────────

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
  waveArea: {
    flex: 1,
    minHeight: 160,
    position: "relative",
    overflow: "hidden",
    background: C.paper,
    borderBottom: `0.5px solid ${C.border}`,
  },
};