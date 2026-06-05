export interface AudioInfo {
  duration: number;
  sampleRate: number;
  levelCount: number;
  /** 1 = 单声道,2 = 立体声(>2 声道在解码时已下混为立体声) */
  channelCount: number;
}

export interface LabelData {
  start: number;
  end: number;
  text: string;
}

export type RenderMode = "envelope" | "polyline" | "stem";

/** Envelope 模式下的单个像素峰值 */
export interface Peak {
  min: number;
  max: number;
  rms: number;
}

/** 单声道渲染数据(三种形态之一,由 kind 区分)*/
export type ChannelData =
  | { kind: "envelope"; peaks: Peak[] }
  | { kind: "polyline"; points: Array<[number, number]> }
  | { kind: "stem"; points: Array<[number, number]> };

/** 一次 getPeaks 调用的完整返回 */
export interface RenderData {
  mode: RenderMode;
  channels: ChannelData[]; // length === AudioInfo.channelCount
  pixelWidth: number;
}

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

export interface WaveformColors {
  /** 包络外层(min/max,浅色)*/
  wave: string;
  /** RMS 内层(深色,显示能量)*/
  waveRms: string;
  playhead: string;
  labelFill: string;
  labelBorder: string;
  selection: string;
  background: string;
  centerLine?: string;
  /** 立体声中间分隔线 */
  channelDivider?: string;
}

export const DEFAULT_COLORS: WaveformColors = {
  // Audacity 经典波形配色 - 深蓝调
  // 包络和 RMS 颜色相近,只靠"内层略深"区分层次
  wave: "#2C4A8C", // 包络
  waveRms: "#2C4A8C", // RMS
  playhead: "#1F2937", // 接近黑的深灰
  labelFill: "#BFDBFE",
  labelBorder: "#3B82F6",
  selection: "#FDE68A", // Audacity 选区是黄色
  background: "#F0F2F8", // 极浅蓝灰,Audacity 主区域风格
  centerLine: "#1F2937", // 接近黑细线
  channelDivider: "#1F2937", // 立体声分隔线
};

export interface GlResources {
  gl: WebGL2RenderingContext;
  program: WebGLProgram;
  vao: WebGLVertexArrayObject;
  vbo: WebGLBuffer;
}

export interface ListenSegment {
  index: number;
  /** ZIP 内的相对路径,e.g. "segments/0000.wav" */
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
