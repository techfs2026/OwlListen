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
import { splitAudio, transcribeSegments, buildZip, getTempDir } from "@/utils/tauriApi";
import type { RenderData } from "@/types/waveform";
import type { SilenceRegion } from "@/hooks/useWebGL";

interface AnnotateScreenProps {
  onBack: () => void;
}

// ── 静音检测 ──────────────────────────────────────────────────────────────────

/**
 * 从 RenderData（Envelope 模式）中计算静音区间。
 *
 * 算法：
 * 1. 收集所有 pixel 的 RMS 值
 * 2. 取中位数 × SILENCE_RATIO 作为阈值（相对阈值，自适应录音电平）
 * 3. 连续低于阈值的 pixel 合并为一个区间
 * 4. 过滤掉过短区间（< MIN_SILENCE_RATIO 的视图宽度），避免噪点
 *
 * 返回归一化坐标（0~1，相对于当前 viewRange），直接传给 WebGL 渲染。
 */
const SILENCE_RATIO = 0.15;       // 低于中位数 × 15% 视为静音
const MIN_SILENCE_RATIO = 0.005;  // 静音区间最小占视图宽度的 0.5%

function computeSilenceRegions(data: RenderData): SilenceRegion[] {
  // 只在 Envelope 模式下有 RMS 数据
  if (data.mode !== "envelope" || data.channels.length === 0) return [];

  const ch = data.channels[0];
  if (ch.kind !== "envelope" || ch.peaks.length === 0) return [];

  const peaks = ch.peaks;
  const n = peaks.length;

  // 1. 计算中位数（对拷贝排序，不破坏原数据）
  const rmsSorted = peaks.map((p) => p.rms).sort((a, b) => a - b);
  const median = rmsSorted[Math.floor(n / 2)];
  const threshold = median * SILENCE_RATIO;

  // 2. 扫描静音 pixel，合并连续区间
  const regions: SilenceRegion[] = [];
  let silStart = -1;

  for (let i = 0; i <= n; i++) {
    const isSilent = i < n && peaks[i].rms <= threshold;

    if (isSilent && silStart === -1) {
      silStart = i;
    } else if (!isSilent && silStart !== -1) {
      const startRatio = silStart / n;
      const endRatio = i / n;
      if (endRatio - startRatio >= MIN_SILENCE_RATIO) {
        regions.push({ startRatio, endRatio });
      }
      silStart = -1;
    }
  }

  return regions;
}

// ── 全局静音区间（秒），用于"跳转到下个静音"─────────────────────────────────

/**
 * 将视图归一化的静音区间转换为绝对秒数。
 * 因为 silenceRegions 是相对于当前 viewRange 的，需要还原到绝对时间轴。
 */
function toAbsSilenceRegions(
  regions: SilenceRegion[],
  viewStart: number,
  viewEnd: number,
): Array<{ start: number; end: number }> {
  const dur = viewEnd - viewStart;
  return regions.map((r) => ({
    start: viewStart + r.startRatio * dur,
    end: viewStart + r.endRatio * dur,
  }));
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

  const audioPathRef = useRef<string>("");
  const containerRef = useRef<HTMLDivElement>(null);

  // ── 静音区间（当前视图归一化）─────────────────────────────────────────────

  const silenceRegions = useMemo<SilenceRegion[]>(() => {
    if (!renderData) return [];
    return computeSilenceRegions(renderData);
  }, [renderData]);

  // 绝对时间静音区间（用于键盘跳转）
  const absSilenceRegions = useMemo(
    () => toAbsSilenceRegions(silenceRegions, viewRange.startSec, viewRange.endSec),
    [silenceRegions, viewRange]
  );

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
    await Promise.all([loadWaveform(path), loadAudio(path)]);
  }, [loadWaveform, loadAudio, clearLabels, unloadAudio, setLoop]);

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
    },
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

  // 功能2：label 边缘拖拽
  const handleLabelEdgeDrag = useCallback(
    (id: string, edge: "start" | "end", newSec: number) => {
      const label = labels.find((l) => l.id === id);
      if (!label) return;
      const clamped = Math.max(0, Math.min(newSec, audioInfo?.duration ?? Infinity));
      if (edge === "start") {
        const newStart = Math.min(clamped, label.end - 0.05);
        updateLabel(id, { start: newStart });
      } else {
        const newEnd = Math.max(clamped, label.start + 0.05);
        updateLabel(id, { end: newEnd });
      }
    },
    [labels, updateLabel, audioInfo]
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
  // P            播放/暂停
  // [            打 in 点
  // ]            打 out 点
  // L            切换回环播放
  // N            跳转到下一个静音区
  // ↑ / ↓        切换选中区段（并跳转视图）
  // ← / →        微调选中区段起点/终点（步长 = 视图宽度 × 0.1%）
  //
  const inPointRef = useRef<number | null>(null);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      // 方向键允许 repeat（按住持续微调）
      const isArrow = e.key === "ArrowLeft" || e.key === "ArrowRight" ||
                      e.key === "ArrowUp"   || e.key === "ArrowDown";
      if (e.repeat && !isArrow) return;

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

      // [ ：打 in 点
      if (e.key === "[") {
        if (loadingState !== "ready") return;
        e.preventDefault();
        inPointRef.current = currentTime;
        console.log(`[punch] in @ ${currentTime.toFixed(3)}s`);
        return;
      }

      // ] ：打 out 点，用 inPoint + currentTime 创建 label
      if (e.key === "]") {
        if (loadingState !== "ready") return;
        e.preventDefault();
        const inPt = inPointRef.current;
        if (inPt === null) return;
        const start = Math.min(inPt, currentTime);
        const end = Math.max(inPt, currentTime);
        if (end - start >= 0.05) {
          addLabel(start, end);
        }
        inPointRef.current = null;
        return;
      }

      // L：切换回环播放（针对最近一个 label，或清除回环）
      if (e.key === "l" || e.key === "L") {
        if (loadingState !== "ready") return;
        e.preventDefault();

        if (loopRange !== null) {
          // 已经在回环，取消
          setLoop(null);
          return;
        }

        // 找当前时间所在的 label，或者最近的 label
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

      // N：跳转到下一个静音区开始处
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

      // ↑ / ↓：切换选中区段
      if (e.key === "ArrowUp" || e.key === "ArrowDown") {
        if (loadingState !== "ready" || labels.length === 0) return;
        e.preventDefault();

        const curIdx = labels.findIndex((l) => l.id === selectedId);
        let nextIdx: number;
        if (curIdx === -1) {
          // 没有选中时：↓ 选第一个，↑ 选最后一个
          nextIdx = e.key === "ArrowDown" ? 0 : labels.length - 1;
        } else {
          nextIdx = e.key === "ArrowDown"
            ? Math.min(curIdx + 1, labels.length - 1)
            : Math.max(curIdx - 1, 0);
        }

        const target = labels[nextIdx];
        setSelectedId(target.id);
        // 跳转视图，让选中区段完整可见
        const pad = (target.end - target.start) * 0.2;
        setViewRange({
          startSec: Math.max(0, target.start - pad),
          endSec: target.end + pad,
        });
        seek(target.start);
        return;
      }

      // ← / →：微调选中区段的起点（←）或终点（→）
      // 步长 = 当前视图时长 × 0.1%，随缩放自动变化
      if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
        if (loadingState !== "ready" || !selectedId) return;
        e.preventDefault();

        const label = labels.find((l) => l.id === selectedId);
        if (!label) return;

        const viewDur = viewRange.endSec - viewRange.startSec;
        const step = viewDur * 0.001; // 0.1% 视图宽度
        const maxSec = audioInfo?.duration ?? Infinity;

        if (e.key === "ArrowLeft") {
          // 调起点向左（向前）
          const newStart = Math.max(0, label.start - step);
          updateLabel(selectedId, { start: Math.min(newStart, label.end - 0.01) });
        } else {
          // 调终点向右（向后）
          const newEnd = Math.min(maxSec, label.end + step);
          updateLabel(selectedId, { end: Math.max(newEnd, label.start + 0.01) });
        }
        return;
      }
    };

    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [
    playState, play, pause, loadingState,
    currentTime, addLabel,
    loopRange, setLoop, labels, seek,
    absSilenceRegions, viewRange, setViewRange,
    selectedId, updateLabel, audioInfo,
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
            silenceRegions={silenceRegions}
            loopRange={loopRange}
            onSeek={handleSeek}
            onRegionSelected={handleRegionSelected}
            onZoom={handleZoom}
            onScroll={scrollBy}
            onLabelEdgeDrag={handleLabelEdgeDrag}
          />
        )}

        {/* in 点指示器：显示打了 in 点但还没打 out 点时 */}
        <InPointIndicator
          inPointSec={inPointRef.current}
          viewRange={viewRange}
          containerWidth={containerWidth}
        />
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
// 在打了 [ 但还没打 ] 时，在波形上显示一条橙色竖线

function InPointIndicator({
  inPointSec,
  viewRange,
  containerWidth,
}: {
  inPointSec: number | null;
  viewRange: { startSec: number; endSec: number };
  containerWidth: number;
}) {
  if (inPointSec === null || containerWidth === 0) return null;
  const dur = viewRange.endSec - viewRange.startSec;
  if (dur <= 0) return null;
  const ratio = (inPointSec - viewRange.startSec) / dur;
  if (ratio < 0 || ratio > 1) return null;

  return (
    <div
      style={{
        position: "absolute",
        top: 0,
        bottom: 0,
        left: `${ratio * 100}%`,
        width: 2,
        background: "#F97316",
        pointerEvents: "none",
        zIndex: 10,
      }}
    >
      {/* 顶部小旗 */}
      <div style={{
        position: "absolute",
        top: 4,
        left: 3,
        background: "#F97316",
        color: "#fff",
        fontSize: 9,
        fontWeight: 700,
        padding: "1px 4px",
        borderRadius: 3,
        whiteSpace: "nowrap",
        letterSpacing: "0.05em",
      }}>
        IN
      </div>
    </div>
  );
}

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