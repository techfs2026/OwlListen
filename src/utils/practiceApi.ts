// 精听播放（Rust 内存 buffer 引擎）的前端封装。
// 对应 src-tauri/src/practice + commands::practice_*。
//
// 事件：
//   "practice-progress" → { positionSec, emitMs }   每 50ms
//   "practice-ended"    → {}                          播完一次
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";

/** 打开并解码音频，返回时长（秒）。path 为本地绝对路径。 */
export async function practiceOpen(path: string): Promise<number> {
  return invoke("practice_open", { path });
}

export async function practicePlay(): Promise<void> {
  return invoke("practice_play");
}

export async function practicePause(): Promise<void> {
  return invoke("practice_pause");
}

export async function practiceSeek(positionSec: number): Promise<void> {
  return invoke("practice_seek", { positionSec });
}

/** 一次性播放区间 [start, end]，到 end 精确停止（忽略 AB 循环）。 */
export async function practicePlaySegment(startSec: number, endSec: number): Promise<void> {
  return invoke("practice_play_segment", { startSec, endSec });
}

/** 设置 AB 循环；传 null 清除循环。 */
export async function practiceSetLoop(range: [number, number] | null): Promise<void> {
  return invoke("practice_set_loop", {
    startSec: range ? range[0] : null,
    endSec: range ? range[1] : null,
  });
}

/** 变速不变调（0.5 ~ 4.0）。保持当前播放位置。 */
export async function practiceSetSpeed(speed: number): Promise<void> {
  return invoke("practice_set_speed", { speed });
}

export async function practiceClose(): Promise<void> {
  return invoke("practice_close");
}

export interface PracticeProgress {
  positionSec: number;
  /** 该位置在 Rust 端被采样/发出的时刻：会话内单调毫秒，供前端对齐时钟测传输延迟 */
  emitMs: number;
}

export function onPracticeProgress(cb: (p: PracticeProgress) => void): Promise<UnlistenFn> {
  return listen<PracticeProgress>("practice-progress", (e) => cb(e.payload));
}

export function onPracticeEnded(cb: () => void): Promise<UnlistenFn> {
  return listen("practice-ended", () => cb());
}
