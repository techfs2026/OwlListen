import { useRef, useCallback, useEffect } from "react";
import type { WaveformColors, GlResources } from "@/types/waveform";

const VERT_SRC = `#version 300 es
precision highp float;
layout(location = 0) in vec2 aPos;
uniform mat4 uMatrix;
void main() {
  gl_Position = uMatrix * vec4(aPos, 0.0, 1.0);
}`;

const FRAG_SRC = `#version 300 es
precision mediump float;
uniform vec4 uColor;
out vec4 fragColor;
void main() {
  fragColor = uColor;
}`;

export interface RenderParams {
  peaks: Float32Array;
  playhead: number;                              // 0~1，-1 表示不显示
  dragRange: [number, number] | null;            // 标记模式拖拽中选区
  labels: Array<{ start: number; end: number }>; // 已保存标记
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
      antialias: true,   // 开启抗锯齿，包络边缘更平滑
      depth: false,
      stencil: false,
      powerPreference: "high-performance",
    });
    if (!gl) { console.error("WebGL2 not available"); return; }

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
    const { peaks, playhead, dragRange, labels, colors } = params;

    const dpr = window.devicePixelRatio || 1;
    const w = canvas.clientWidth  * dpr;
    const h = canvas.clientHeight * dpr;
    if (canvas.width !== w || canvas.height !== h) {
      canvas.width  = w;
      canvas.height = h;
    }

    gl.viewport(0, 0, w, h);
    const bg = hexToVec4(colors.background);
    gl.clearColor(bg[0], bg[1], bg[2], 1.0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(program);
    gl.bindVertexArray(vao);

    const uMatrix = gl.getUniformLocation(program, "uMatrix");
    const uColor  = gl.getUniformLocation(program, "uColor");
    gl.uniformMatrix4fv(uMatrix, false, orthoMatrix(w, h));

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const midY      = h * 0.5;
    const scaleY    = h * 0.2;  // 波形占高度 92%，留少许上下边距
    const peakCount = peaks.length / 2;

    // ── 1. 中心参考线 ─────────────────────────────────────────────────────────
    {
      const cc = hexToVec4(colors.centerLine ?? "#C8D6F0");
      gl.uniform4f(uColor, cc[0], cc[1], cc[2], 0.6);
      uploadAndDraw(gl, vbo,
        new Float32Array([0, midY, w, midY]),
        gl.LINES);
    }

    // ── 2. 已保存标记：浅蓝填充 + 边线 ───────────────────────────────────────
    if (labels.length > 0) {
      const fill   = hexToVec4(colors.labelFill);
      const border = hexToVec4(colors.labelBorder);
      for (const lbl of labels) {
        const lx = lbl.start * w;
        const rx = lbl.end   * w;
        gl.uniform4f(uColor, fill[0], fill[1], fill[2], 0.4);
        uploadAndDraw(gl, vbo, makeRect(lx, 0, rx, h), gl.TRIANGLES);
        gl.uniform4f(uColor, border[0], border[1], border[2], 0.7);
        uploadAndDraw(gl, vbo,
          new Float32Array([lx, 0, lx, h, rx, 0, rx, h]), gl.LINES);
      }
    }

    // ── 3. 拖拽选区：更浅天蓝 ────────────────────────────────────────────────
    if (dragRange) {
      const [ds, de] = dragRange;
      const lx = ds * w;
      const rx = de * w;
      const sc = hexToVec4(colors.selection);
      gl.uniform4f(uColor, sc[0], sc[1], sc[2], 0.3);
      uploadAndDraw(gl, vbo, makeRect(lx, 0, rx, h), gl.TRIANGLES);
      gl.uniform4f(uColor, sc[0], sc[1], sc[2], 0.7);
      uploadAndDraw(gl, vbo,
        new Float32Array([lx, 0, lx, h, rx, 0, rx, h]), gl.LINES);
    }

    // ── 4. 波形填充：TRIANGLE_STRIP 一次绘制整个包络 ──────────────────────────
    //
    // TRIANGLE_STRIP 顶点布局（每列 2 个顶点，交替上下）：
    //   top0, bot0, top1, bot1, top2, bot2, ...
    //
    // 相邻两对顶点自动构成一个四边形，N 列共 2N 个顶点，N-1 个四边形，
    // 比 TRIANGLES（需 6N 个顶点）节省 2/3 的数据量。
    //
    // 振幅直接线性映射，上下严格对称（不用 shapeAmp），
    // 和 Audacity 视觉风格一致。
    //
    const stripVerts = new Float32Array(peakCount * 4); // 每列 [topX,topY, botX,botY]
    for (let i = 0; i < peakCount; i++) {
      const x   = (i / (peakCount - 1)) * w;           // 均匀分布到全宽
      const amp = peaks[i * 2 + 1];                     // max（向上）
      const low = peaks[i * 2];                         // min（向下）
      const top = midY - amp * scaleY;                  // min 是负数所以向下
      const bot = midY - low * scaleY;

      stripVerts[i * 4]     = x;
      stripVerts[i * 4 + 1] = top;
      stripVerts[i * 4 + 2] = x;
      stripVerts[i * 4 + 3] = bot;
    }

    const wc = hexToVec4(colors.wave);
    gl.uniform4f(uColor, wc[0], wc[1], wc[2], 0.85);
    uploadAndDraw(gl, vbo, stripVerts, gl.TRIANGLE_STRIP);

    // 包络上边线（让边缘更锐利，类似 Audacity 的轮廓感）
    const topLine = new Float32Array(peakCount * 2);
    const botLine = new Float32Array(peakCount * 2);
    for (let i = 0; i < peakCount; i++) {
      const x = (i / (peakCount - 1)) * w;
      topLine[i * 2]     = x;
      topLine[i * 2 + 1] = stripVerts[i * 4 + 1]; // top
      botLine[i * 2]     = x;
      botLine[i * 2 + 1] = stripVerts[i * 4 + 3]; // bot
    }
    gl.uniform4f(uColor, wc[0], wc[1], wc[2], 1.0);
    uploadAndDraw(gl, vbo, topLine, gl.LINE_STRIP);
    uploadAndDraw(gl, vbo, botLine, gl.LINE_STRIP);

    // ── 5. 播放头：单条竖线 ───────────────────────────────────────────────────
    if (playhead >= 0 && playhead <= 1) {
      const px  = playhead * w;
      const phc = hexToVec4(colors.playhead);
      gl.uniform4f(uColor, phc[0], phc[1], phc[2], 1.0);
      uploadAndDraw(gl, vbo, makeRect(px - 1, 0, px + 1, h), gl.TRIANGLES);
    }

    gl.bindVertexArray(null);
    gl.disable(gl.BLEND);
  }, []);

  return { canvasRef, render };
}

// ── 工具函数 ──────────────────────────────────────────────────────────────────

function createProgram(gl: WebGL2RenderingContext, vs: string, fs: string) {
  const vert = compileShader(gl, gl.VERTEX_SHADER,   vs);
  const frag = compileShader(gl, gl.FRAGMENT_SHADER, fs);
  if (!vert || !frag) return null;
  const p = gl.createProgram()!;
  gl.attachShader(p, vert); gl.attachShader(p, frag);
  gl.linkProgram(p);
  gl.deleteShader(vert); gl.deleteShader(frag);
  if (!gl.getProgramParameter(p, gl.LINK_STATUS)) {
    console.error("Link error:", gl.getProgramInfoLog(p));
    return null;
  }
  return p;
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src); gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    console.error("Compile error:", gl.getShaderInfoLog(s));
    gl.deleteShader(s); return null;
  }
  return s;
}

function uploadAndDraw(gl: WebGL2RenderingContext, vbo: WebGLBuffer, data: Float32Array, mode: number) {
  gl.bindBuffer(gl.ARRAY_BUFFER, vbo);
  gl.bufferData(gl.ARRAY_BUFFER, data, gl.DYNAMIC_DRAW);
  gl.drawArrays(mode, 0, data.length / 2);
}

function makeRect(x0: number, y0: number, x1: number, y1: number): Float32Array {
  return new Float32Array([x0,y0, x1,y0, x0,y1, x1,y0, x1,y1, x0,y1]);
}

function orthoMatrix(w: number, h: number): Float32Array {
  return new Float32Array([2/w,0,0,0, 0,-2/h,0,0, 0,0,-1,0, -1,1,0,1]);
}

function hexToVec4(hex: string): [number, number, number, number] {
  const c = hex.replace("#", "");
  return [
    parseInt(c.slice(0,2),16)/255,
    parseInt(c.slice(2,4),16)/255,
    parseInt(c.slice(4,6),16)/255,
    c.length === 8 ? parseInt(c.slice(6,8),16)/255 : 1.0,
  ];
}