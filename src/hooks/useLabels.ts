import { useState, useCallback } from "react";
import { saveLabels, loadLabels } from "@/utils/tauriApi";
import type { Label } from "@/types/waveform";

interface UseLabelsReturn {
  labels: Label[];
  addLabel: (start: number, end: number, text?: string) => Label;
  removeLabel: (id: string) => void;
  updateLabel: (id: string, patch: Partial<Omit<Label, "id">>) => void;
  clearLabels: () => void;
  saveToFile: (path: string) => Promise<void>;
  loadFromFile: (path: string) => Promise<void>;
}

export function useLabels(): UseLabelsReturn {
  const [labels, setLabels] = useState<Label[]>([]);

  const addLabel = useCallback((start: number, end: number, text = ""): Label => {
    const label: Label = {
      id: crypto.randomUUID(),
      start: Math.min(start, end),
      end: Math.max(start, end),
      text,
    };
    // 插入时保持按 start 排序
    setLabels((prev) => {
      const idx = prev.findIndex((l) => l.start > label.start);
      if (idx === -1) return [...prev, label];
      const next = [...prev];
      next.splice(idx, 0, label);
      return next;
    });
    return label;
  }, []);

  const removeLabel = useCallback((id: string) => {
    setLabels((prev) => prev.filter((l) => l.id !== id));
  }, []);

  const updateLabel = useCallback((id: string, patch: Partial<Omit<Label, "id">>) => {
    setLabels((prev) => prev.map((l) => (l.id === id ? { ...l, ...patch } : l)));
  }, []);

  const clearLabels = useCallback(() => setLabels([]), []);

  const saveToFile = useCallback(
    async (path: string) => {
      await saveLabels(labels, path);
    },
    [labels],
  );

  const loadFromFile = useCallback(async (path: string) => {
    const loaded = await loadLabels(path);
    setLabels(loaded);
  }, []);

  return {
    labels,
    addLabel,
    removeLabel,
    updateLabel,
    clearLabels,
    saveToFile,
    loadFromFile,
  };
}
