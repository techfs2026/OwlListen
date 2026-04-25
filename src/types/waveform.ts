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
  wave: string;
  playhead: string;
  labelFill: string;
  labelBorder: string;
  selection: string;
  background: string;
  centerLine?: string;
}

export const DEFAULT_COLORS: WaveformColors = {
  wave:        "#2563EB",
  playhead:    "#1D4ED8",
  labelFill:   "#BFDBFE",
  labelBorder: "#3B82F6",
  selection:   "#BAE6FD",
  background:  "#FAFAF7",
  centerLine:  "#C8D6F0",
};

// ── WebGL 内部类型 ────────────────────────────────────────────────────────────

export interface GlResources {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
}

// ── 精听模式类型 ──────────────────────────────────────────────────────────────

export interface ListenSegment {
  index: number;
  /** ZIP 内的相对路径，e.g. "segments/0000.wav" */
  audio: string;
  start: number;
  end: number;
  /** Whisper 转写原文 */
  text: string;
  /** 标注时用户填写的备注 */
  label: string;
}

export interface PackMetadata {
  version: number;
  segments: ListenSegment[];
}

export type SegmentStatus = "pending" | "done" | "flagged";

export interface SegmentState {
  status: SegmentStatus;
  /** 用户听写内容 */
  userText: string;
}