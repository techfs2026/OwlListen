import { useState, useCallback, useRef } from "react";
import type { PackMetadata, ListenSegment, SegmentState, SegmentStatus } from "@/types/waveform";

export interface PackState {
  meta: PackMetadata | null;
  /** segment index → blob URL（已解压的 audio URL） */
  audioBlobUrls: Map<number, string>;
  segStates: Map<number, SegmentState>;
  currentIndex: number;
}

interface UsePackReturn {
  pack: PackState;
  loadZip: (file: File) => Promise<void>;
  isLoading: boolean;
  error: string | null;
  setCurrentIndex: (i: number) => void;
  updateSegState: (i: number, patch: Partial<SegmentState>) => void;
  markStatus: (i: number, status: SegmentStatus) => void;
  getAudioUrl: (i: number) => string | undefined;
  getCurrentSeg: () => ListenSegment | null;
}

export function usePack(): UsePackReturn {
  const [pack, setPack] = useState<PackState>({
    meta: null,
    audioBlobUrls: new Map(),
    segStates: new Map(),
    currentIndex: 0,
  });
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 释放旧的 blob URLs
  const prevUrlsRef = useRef<Map<number, string>>(new Map());

  const loadZip = useCallback(async (file: File) => {
    setIsLoading(true);
    setError(null);

    try {
      // 动态加载 JSZip
      const JSZip = (await import("jszip")).default;
      const zip = await JSZip.loadAsync(file);

      // 读取 metadata.json
      const metaFile = zip.file("metadata.json");
      if (!metaFile) throw new Error("ZIP 中找不到 metadata.json");
      const metaJson = await metaFile.async("string");
      const meta: PackMetadata = JSON.parse(metaJson);

      // 释放旧的 blob URLs
      for (const url of prevUrlsRef.current.values()) {
        URL.revokeObjectURL(url);
      }

      // 解压所有音频文件 → blob URL
      const audioBlobUrls = new Map<number, string>();
      for (const seg of meta.segments) {
        const audioFile = zip.file(seg.audio);
        if (!audioFile) continue;
        const blob = await audioFile.async("blob");
        const url = URL.createObjectURL(new Blob([blob], { type: "audio/wav" }));
        audioBlobUrls.set(seg.index, url);
      }

      prevUrlsRef.current = audioBlobUrls;

      // 初始化每个片段状态
      const segStates = new Map<number, SegmentState>();
      for (const seg of meta.segments) {
        segStates.set(seg.index, { status: "pending", userText: "" });
      }

      setPack({ meta, audioBlobUrls, segStates, currentIndex: 0 });
    } catch (err) {
      setError(String(err));
    } finally {
      setIsLoading(false);
    }
  }, []);

  const setCurrentIndex = useCallback((i: number) => {
    setPack((prev) => ({ ...prev, currentIndex: i }));
  }, []);

  const updateSegState = useCallback((i: number, patch: Partial<SegmentState>) => {
    setPack((prev) => {
      const next = new Map(prev.segStates);
      const cur = next.get(i) ?? { status: "pending" as SegmentStatus, userText: "" };
      next.set(i, { ...cur, ...patch });
      return { ...prev, segStates: next };
    });
  }, []);

  const markStatus = useCallback(
    (i: number, status: SegmentStatus) => {
      updateSegState(i, { status });
    },
    [updateSegState],
  );

  const getAudioUrl = useCallback((i: number) => pack.audioBlobUrls.get(i), [pack.audioBlobUrls]);

  const getCurrentSeg = useCallback((): ListenSegment | null => {
    if (!pack.meta) return null;
    return pack.meta.segments[pack.currentIndex] ?? null;
  }, [pack.meta, pack.currentIndex]);

  return {
    pack,
    loadZip,
    isLoading,
    error,
    setCurrentIndex,
    updateSegState,
    markStatus,
    getAudioUrl,
    getCurrentSeg,
  };
}
