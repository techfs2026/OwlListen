import { useRef, useCallback, useEffect } from "react";
import type {
  ChannelData,
  RenderData,
  WaveformColors,
  GlResources,
} from "@/types/waveform";

// ── shaders ──────────────────────────────────────────────────────────────────

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform mat4 uMatrix;
uniform float uPointSize;
void main() {
  gl_Position = uMatrix * vec4(aPos, 0.0, 1.0);
  gl_PointSize = uPointSize;
}`;

const FRAG_SRC = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 fragColor;
void main() {
  fragColor = uColor;
}`;

// ── 渲染参数 ─────────────────────────────────────────────────────────────────

export interface RenderParams {
  data: RenderData | null;
  playhead: number;                              // 0~1,-1 表示不显示
  dragRange: [number, number] | null;            // 拖拽中的选区(归一化坐标)
  labels: Array<{ start: number; end: number }>; // 已保存标记(归一化)
  colors: WaveformColors;
}

interface UseWebGLReturn {
  canvasRef: React.RefObject<HTMLCanvasElement>;
  render: (params: RenderParams) => void;
}

export function useWebGL(): UseWebGLReturn {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const glRef = useRef<GlResources | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext("webgl2", {
      alpha: false,
      antialias: true,
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) {
      console.error("WebGL2 not available");
      return;
    }

    const program = createProgram(gl, VERT_SRC, FRAG_SRC);
    if (!program) return;

    const vao = gl.createVertexArray()!;
    const vbo = gl.createBuffer()!;

    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
    gl.enableVertexAttribArray(0);
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 8, 0);
    gl.bindVertexArray(null);

    glRef.current = { gl, program, vao, vbo };

    return () => {
      gl.deleteProgram(program);
      gl.deleteVertexArray(vao);
      gl.deleteBuffer(vbo);
      glRef.current = null;
    };
  }, []);

  const render = useCallback((params: RenderParams) => {
    const res = glRef.current;
    const canvas = canvasRef.current;
    if (!res || !canvas) return;

    const { gl, program, vao, vbo } = res;
    const { data, playhead, dragRange, labels, colors } = params;

    // 处理 DPR / 画布尺寸
    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth * dpr;
    const h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width = w;
      canvas.height = h;
    }

    gl.viewport(0, 0, w, h);
    const bg = hexToVec4(colors.background);
    gl.clearColor(bg[0], bg[1], bg[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const uMatrix = gl.getUniformLocation(program, "uMatrix");
    const uColor = gl.getUniformLocation(program, "uColor");
    const uPointSize = gl.getUniformLocation(program, "uPointSize");
    gl.uniformMatrix4fv(uMatrix, false, orthoMatrix(w, h));
    gl.uniform1f(uPointSize, 1.0); // 默认,Stem 模式会改

    // ── 1. 标签底色 / 拖拽选区(全画布高度,跨声道)──────────────────────────
    drawLabelsAndSelection(gl, vbo, uColor, w, h, labels, dragRange, colors);

    // ── 2. 波形(按声道布局)─────────────────────────────────────────────
    if (data && data.channels.length > 0) {
      const channelCount = data.channels.length;
      // 立体声:上下分屏;单声道:占满
      // 每个声道的可用高度,留 8% 做顶/底边距,2 声道间还要让出中线
      const laneH = h / channelCount;
      const laneAmpScale = laneH * 0.42; // 每个声道振幅缩放
      // 各声道中心 Y
      for (let i = 0; i < channelCount; i++) {
        const midY = laneH * (i + 0.5);
        drawChannel(
          gl, vbo, uColor, uPointSize,
          data.channels[i],
          0, w, midY, laneAmpScale,
          colors,
        );
      }

      // 立体声中间分隔线
      if (channelCount === 2) {
        const dc = hexToVec4(colors.channelDivider ?? "#D1D5DB");
        gl.uniform4f(uColor, dc[0], dc[1], dc[2], 0.6);
        uploadAndDraw(gl, vbo, new Float32Array([0, laneH, w, laneH]), gl.LINES);
      }
    }

    // ── 3. 播放头 ─────────────────────────────────────────────────────────
    if (playhead >= 0 && playhead <= 1) {
      const px = playhead * w;
      const phc = hexToVec4(colors.playhead);
      gl.uniform4f(uColor, phc[0], phc[1], phc[2], 1.0);
      uploadAndDraw(gl, vbo, makeRect(px - 1, 0, px + 1, h), gl.TRIANGLES);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }, []);

  return { canvasRef, render };
}

// ── 标签 / 拖拽选区 ──────────────────────────────────────────────────────────

function drawLabelsAndSelection(
  gl: WebGL2RenderingContext,
  vbo: WebGLBuffer,
  uColor: WebGLUniformLocation | null,
  w: number,
  h: number,
  labels: Array<{ start: number; end: number }>,
  dragRange: [number, number] | null,
  colors: WaveformColors,
) {
  // 注意:中心线由每个声道在 drawChannel 里自行绘制(midY 因声道数变化)
  // 这里不再画全画布的中心线

  // 已保存标签
  if (labels.length > 0) {
    const fill = hexToVec4(colors.labelFill);
    const border = hexToVec4(colors.labelBorder);
    for (const lbl of labels) {
      const lx = lbl.start * w;
      const rx = lbl.end * w;
      gl.uniform4f(uColor, fill[0], fill[1], fill[2], 0.4);
      uploadAndDraw(gl, vbo, makeRect(lx, 0, rx, h), gl.TRIANGLES);
      gl.uniform4f(uColor, border[0], border[1], border[2], 0.7);
      uploadAndDraw(
        gl, vbo,
        new Float32Array([lx, 0, lx, h, rx, 0, rx, h]),
        gl.LINES,
      );
    }
  }

  // 拖拽选区
  if (dragRange) {
    const [ds, de] = dragRange;
    const lx = ds * w;
    const rx = de * w;
    const sc = hexToVec4(colors.selection);
    gl.uniform4f(uColor, sc[0], sc[1], sc[2], 0.3);
    uploadAndDraw(gl, vbo, makeRect(lx, 0, rx, h), gl.TRIANGLES);
    gl.uniform4f(uColor, sc[0], sc[1], sc[2], 0.7);
    uploadAndDraw(
      gl, vbo,
      new Float32Array([lx, 0, lx, h, rx, 0, rx, h]),
      gl.LINES,
    );
  }
}

// ── 单声道波形渲染(三模式分发)───────────────────────────────────────────

function drawChannel(
  gl: WebGL2RenderingContext,
  vbo: WebGLBuffer,
  uColor: WebGLUniformLocation | null,
  uPointSize: WebGLUniformLocation | null,
  ch: ChannelData,
  xStart: number, xEnd: number,
  midY: number, ampScale: number,
  colors: WaveformColors,
) {
  // 该声道的中心参考线(每个声道独立一条,位于自己的 midY)
  const cc = hexToVec4(colors.centerLine ?? "#1F2937");
  gl.uniform4f(uColor, cc[0], cc[1], cc[2], 0.5);
  uploadAndDraw(gl, vbo, new Float32Array([xStart, midY, xEnd, midY]), gl.LINES);

  switch (ch.kind) {
    case "envelope":
      drawEnvelope(gl, vbo, uColor, ch.peaks, xStart, xEnd, midY, ampScale, colors);
      break;
    case "polyline":
      drawPolyline(gl, vbo, uColor, ch.points, xStart, xEnd, midY, ampScale, colors, false);
      break;
    case "stem":
      drawPolyline(gl, vbo, uColor, ch.points, xStart, xEnd, midY, ampScale, colors, true);
      gl.uniform1f(uPointSize, 4.0);
      drawSamplePoints(gl, vbo, uColor, ch.points, xStart, xEnd, midY, ampScale, colors);
      gl.uniform1f(uPointSize, 1.0);
      break;
  }
}

// ── Envelope 模式:min/max 包络 + RMS 双层 ─────────────────────────────────

function drawEnvelope(
  gl: WebGL2RenderingContext,
  vbo: WebGLBuffer,
  uColor: WebGLUniformLocation | null,
  peaks: Array<{ min: number; max: number; rms: number }>,
  xStart: number, xEnd: number,
  midY: number, ampScale: number,
  colors: WaveformColors,
) {
  const n = peaks.length;
  if (n === 0) return;
  const xRange = xEnd - xStart;

  // min/max 包络顶点(每个 pixel 两个顶点:上 max,下 min,组成 TRIANGLE_STRIP)
  const envVerts = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = xStart + (i / Math.max(1, n - 1)) * xRange;
    const p = peaks[i];
    envVerts[i * 4]     = x;
    envVerts[i * 4 + 1] = midY - p.max * ampScale;
    envVerts[i * 4 + 2] = x;
    envVerts[i * 4 + 3] = midY - p.min * ampScale;
  }
  // 包络层:min/max 实心填充(Audacity 风格,不透明)
  const wc = hexToVec4(colors.wave);
  gl.uniform4f(uColor, wc[0], wc[1], wc[2], 1.0);
  uploadAndDraw(gl, vbo, envVerts, gl.TRIANGLE_STRIP);

  // RMS 内层:实心填充,深色,完全覆盖在包络内部
  // Audacity 现代风格不画包络轮廓线——靠包络色和 RMS 色的对比就够了
  const rmsVerts = new Float32Array(n * 4);
  for (let i = 0; i < n; i++) {
    const x = xStart + (i / Math.max(1, n - 1)) * xRange;
    const r = peaks[i].rms;
    rmsVerts[i * 4]     = x;
    rmsVerts[i * 4 + 1] = midY - r * ampScale;
    rmsVerts[i * 4 + 2] = x;
    rmsVerts[i * 4 + 3] = midY + r * ampScale;
  }
  const rc = hexToVec4(colors.waveRms);
  gl.uniform4f(uColor, rc[0], rc[1], rc[2], 1.0);
  uploadAndDraw(gl, vbo, rmsVerts, gl.TRIANGLE_STRIP);
}

// ── Polyline / Stem 模式:从原始样本画折线 ──────────────────────────────────

function drawPolyline(
  gl: WebGL2RenderingContext,
  vbo: WebGLBuffer,
  uColor: WebGLUniformLocation | null,
  points: Array<[number, number]>,
  xStart: number, xEnd: number,
  midY: number, ampScale: number,
  colors: WaveformColors,
  _isStem: boolean,
) {
  const n = points.length;
  if (n === 0) return;

  // Rust 端给的 x 是相对 pixel(基于 pixelWidth 已做 DPR 放大),y 是样本值 [-1, 1]
  // 这里 xStart/xEnd 是 DPR 后的物理像素
  // 两者使用同一个 pixelWidth 基准,所以 Rust 给的 x 就是物理像素坐标(已经是 0~w)
  const verts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    verts[i * 2]     = points[i][0];                    // 已经是 0~pixelWidth 的物理像素
    verts[i * 2 + 1] = midY - points[i][1] * ampScale;
  }

  const rc = hexToVec4(colors.waveRms);
  gl.uniform4f(uColor, rc[0], rc[1], rc[2], 0.95);
  uploadAndDraw(gl, vbo, verts, gl.LINE_STRIP);

  // 抑制 unused 警告
  void xStart; void xEnd; void _isStem;
}

function drawSamplePoints(
  gl: WebGL2RenderingContext,
  vbo: WebGLBuffer,
  uColor: WebGLUniformLocation | null,
  points: Array<[number, number]>,
  xStart: number, xEnd: number,
  midY: number, ampScale: number,
  colors: WaveformColors,
) {
  const n = points.length;
  if (n === 0) return;

  const verts = new Float32Array(n * 2);
  for (let i = 0; i < n; i++) {
    verts[i * 2]     = points[i][0];
    verts[i * 2 + 1] = midY - points[i][1] * ampScale;
  }
  const rc = hexToVec4(colors.waveRms);
  gl.uniform4f(uColor, rc[0], rc[1], rc[2], 1.0);
  uploadAndDraw(gl, vbo, verts, gl.POINTS);

  void xStart; void xEnd;
}

// ── WebGL 工具函数 ──────────────────────────────────────────────────────────

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const vert = compileShader(gl, gl.VERTEX_SHADER, vs);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  if (!vert || !frag) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, vert);
  gl.attachShader(p, frag);
  gl.linkProgram(p);
  gl.deleteShader(vert);
  gl.deleteShader(frag);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error("Link error:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("Compile error:", gl.getShaderInfoLog(s));
    gl.deleteShader(s);
    return null;
  }
  return s;
}

function uploadAndDraw(
  gl: WebGL2RenderingContext,
  vbo: WebGLBuffer,
  data: Float32Array,
  mode: number,
) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.drawArrays(mode, 0, data.length / 2);
}

function makeRect(x0: number, y0: number, x1: number, y1: number): Float32Array {
  return new Float32Array([x0, y0, x1, y0, x0, y1, x1, y0, x1, y1, x0, y1]);
}

function orthoMatrix(w: number, h: number): Float32Array {
  return new Float32Array([2 / w, 0, 0, 0, 0, -2 / h, 0, 0, 0, 0, -1, 0, -1, 1, 0, 1]);
}

function hexToVec4(hex: string): [number, number, number, number] {
  const c = hex.replace("#", "");
  return [
    parseInt(c.slice(0, 2), 16) / 255,
    parseInt(c.slice(2, 4), 16) / 255,
    parseInt(c.slice(4, 6), 16) / 255,
    c.length === 8 ? parseInt(c.slice(6, 8), 16) / 255 : 1.0,
  ];
}