import { invoke } from "@tauri-apps/api/core";
import type { AudioInfo, Label, LabelData } from "@/types/waveform";

/** 加载音频文件，返回元信息 */
export async function loadAudio(path: string): Promise<AudioInfo> {
  const info = await invoke<AudioInfo>("load_audio", { path });
  return {
    duration: info.duration,
    sampleRate: info.sample_rate ?? info.sampleRate,
    levelCount: info.level_count ?? info.levelCount,
  };
}

/**
 * 获取当前视图的峰值数据
 * 返回 Float32Array：[min0, max0, min1, max1, ...]
 * 每两个值对应一个像素列的波形范围
 */
export async function getPeaks(
  startSec: number,
  endSec: number,
  pixelWidth: number
): Promise<Float32Array> {
  const bytes = await invoke<number[]>("get_peaks", {
    view: { start_sec: startSec, end_sec: endSec, pixel_width: pixelWidth },
  });
  // Tauri 把 Vec<u8> 序列化为 number[]，这里还原为 Float32Array
  const buffer = new Uint8Array(bytes).buffer;
  return new Float32Array(buffer);
}

/** 保存标记文件（Audacity 格式） */
export async function saveLabels(
  labels: Label[],
  path: string
): Promise<void> {
  const data: LabelData[] = labels.map((l) => ({
    start: l.start,
    end: l.end,
    text: l.text,
  }));
  await invoke("save_labels", { labels: data, path });
}

/** 加载标记文件 */
export async function loadLabels(path: string): Promise<Label[]> {
  const raw = await invoke<LabelData[]>("load_labels", { path });
  return raw.map((r, i) => ({
    id: crypto.randomUUID(),
    start: r.start,
    end: r.end,
    text: r.text ?? `段落 ${i + 1}`,
  }));
}
