// ── 来自 Rust 的数据 ──────────────────────────────────────────────────────────

export interface AudioInfo {
  duration: number;
  sampleRate: number;
  levelCount: number;
}

export interface LabelData {
  start: number;
  end: number;
  text: string;
}

// ── 前端状态 ──────────────────────────────────────────────────────────────────

export interface Label {
  id: string;
  start: number;
  end: number;
  text: string;
}

export interface ViewRange {
  startSec: number;
  endSec: number;
}

export type LoadingState = "idle" | "decoding" | "building" | "ready" | "error";

// ── 渲染配置 ──────────────────────────────────────────────────────────────────

export interface WaveformColors {
  wave: string;         // 波形填充色
  playhead: string;     // 播放头竖线
  labelFill: string;    // 已保存标记填充色
  labelBorder: string;  // 已保存标记边线色
  selection: string;    // 拖拽中选区填充色
  background: string;   // 背景色
  centerLine?: string;  // 中心参考线（可选）
}

export const DEFAULT_COLORS: WaveformColors = {
  wave:        "#2563EB",  // 蓝色波形
  playhead:    "#1D4ED8",  // 深蓝播放头
  labelFill:   "#BFDBFE",  // 浅蓝标记填充（blue-200）
  labelBorder: "#3B82F6",  // 蓝色标记边线
  selection:   "#BAE6FD",  // 天蓝拖拽选区（sky-200）
  background:  "#F8FAFF",  // 白色背景
  centerLine:  "#C8D6F0",  // 中心参考线
};

// ── WebGL 内部类型 ────────────────────────────────────────────────────────────

export interface GlResources {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
}