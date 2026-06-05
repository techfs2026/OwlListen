import { useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

// ── 类型 ───────────────────────────────────────────────────────────────────────

export type SpeechState =
  | "idle" // 空闲，可以开始录音
  | "listening" // 录音中
  | "transcribing" // 录音结束，正在调 Whisper 转写
  | "unsupported"; // 浏览器不支持 MediaRecorder（理论上 Tauri 都支持）

export interface UseSpeechInputOptions {
  /** Whisper 模型，默认 "small"（约 465MB，质量优先，全应用统一） */
  model?: string;
}

export interface UseSpeechInputReturn {
  speechState: SpeechState;
  /** 切换 录音/停止 */
  toggleListening: () => void;
  /** 强制停止录音（如果正在录） */
  stopListening: () => void;
}

// ── 选择浏览器支持的音频格式 ──────────────────────────────────────────────────
//
// Chromium-based WebView (Linux/Windows): WebM/Opus 优先
// macOS WKWebView (Tauri): 通常只支持 mp4/aac，不支持 webm
// 通过 isTypeSupported 探测，确保选到能用的
function pickMimeType(): { mimeType: string; extension: string } | null {
  if (typeof MediaRecorder === "undefined") return null;

  const candidates: { mimeType: string; extension: string }[] = [
    { mimeType: "audio/webm;codecs=opus", extension: "webm" },
    { mimeType: "audio/webm", extension: "webm" },
    { mimeType: "audio/mp4;codecs=mp4a.40.2", extension: "mp4" },
    { mimeType: "audio/mp4", extension: "mp4" },
    { mimeType: "audio/ogg;codecs=opus", extension: "ogg" },
    { mimeType: "audio/aac", extension: "aac" },
  ];

  for (const c of candidates) {
    if (MediaRecorder.isTypeSupported(c.mimeType)) return c;
  }
  // 最后兜底：浏览器默认（可能是 webm 或 mp4，靠 extension 一栏只能猜）
  return { mimeType: "", extension: "webm" };
}

// ── Hook ───────────────────────────────────────────────────────────────────────

/**
 * 录音 → Whisper 本地转写。
 *
 * 流程：toggle → 浏览器申请麦克风 → MediaRecorder 录音
 *      → 用户再次 toggle → stop → 收集 Blob
 *      → invoke("transcribe_recording", ...)
 *      → onTranscript(text, true)
 *
 * 注意：与原 Web Speech 版本不同，这里**不会触发 interim 回调**——
 * Whisper 是一次性转写，没有"识别中"的中间结果。所以传给 onTranscript
 * 的总是 isFinal=true。
 */
export function useSpeechInput(
  onTranscript: (text: string, isFinal: boolean) => void,
  options: UseSpeechInputOptions = {},
): UseSpeechInputReturn {
  const { model = "small" } = options;

  const [speechState, setSpeechState] = useState<SpeechState>(() => {
    if (typeof MediaRecorder === "undefined") return "unsupported";
    if (!navigator.mediaDevices?.getUserMedia) return "unsupported";
    return "idle";
  });

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const formatRef = useRef<{ mimeType: string; extension: string } | null>(null);

  // 用 ref 包住回调，避免 closure 过时
  const onTranscriptRef = useRef(onTranscript);
  useEffect(() => {
    onTranscriptRef.current = onTranscript;
  }, [onTranscript]);

  // 释放音频流（关掉麦克风指示灯）
  const releaseStream = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const startListening = useCallback(async () => {
    if (speechState !== "idle") return;

    const fmt = pickMimeType();
    if (!fmt) {
      console.warn("[useSpeechInput] no supported MediaRecorder format");
      setSpeechState("unsupported");
      return;
    }
    formatRef.current = fmt;

    let stream: MediaStream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          // 让浏览器/系统帮忙做基础降噪和回声消除，能显著提升 Whisper 识别率
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
          channelCount: 1,
        },
      });
    } catch (e) {
      console.warn("[useSpeechInput] getUserMedia failed:", e);
      // 用户拒绝授权 / 系统未授权 / 没有麦克风
      setSpeechState("idle");
      return;
    }
    streamRef.current = stream;

    let recorder: MediaRecorder;
    try {
      recorder = fmt.mimeType
        ? new MediaRecorder(stream, { mimeType: fmt.mimeType })
        : new MediaRecorder(stream);
    } catch (e) {
      console.warn("[useSpeechInput] MediaRecorder failed:", e);
      releaseStream();
      setSpeechState("idle");
      return;
    }

    chunksRef.current = [];

    recorder.ondataavailable = (e) => {
      if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
    };

    recorder.onerror = (e) => {
      console.warn("[useSpeechInput] recorder error:", e);
      releaseStream();
      setSpeechState("idle");
    };

    recorder.onstop = async () => {
      releaseStream();

      const blob = new Blob(chunksRef.current, {
        type: fmt.mimeType || "audio/webm",
      });
      chunksRef.current = [];

      if (blob.size === 0) {
        setSpeechState("idle");
        return;
      }

      setSpeechState("transcribing");
      try {
        const buffer = await blob.arrayBuffer();
        // Tauri 的 invoke 会把 Uint8Array 序列化为 Vec<u8>
        const audioBytes = Array.from(new Uint8Array(buffer));

        const text = await invoke<string>("transcribe_recording", {
          audioBytes,
          extension: fmt.extension,
          model,
        });

        const trimmed = text.trim();
        if (trimmed) {
          onTranscriptRef.current(trimmed, true);
        }
      } catch (e) {
        console.warn("[useSpeechInput] transcribe error:", e);
      } finally {
        setSpeechState("idle");
      }
    };

    recorderRef.current = recorder;
    recorder.start();
    setSpeechState("listening");
  }, [speechState, model, releaseStream]);

  const stopListening = useCallback(() => {
    const r = recorderRef.current;
    if (r && r.state !== "inactive") {
      r.stop(); // 触发 onstop → 自动转写
    }
    recorderRef.current = null;
  }, []);

  const toggleListening = useCallback(() => {
    if (speechState === "listening") {
      stopListening();
    } else if (speechState === "idle") {
      void startListening();
    }
    // transcribing 状态下不响应（避免重复触发）
  }, [speechState, startListening, stopListening]);

  // 卸载时清理资源
  useEffect(
    () => () => {
      if (recorderRef.current && recorderRef.current.state !== "inactive") {
        recorderRef.current.stop();
      }
      recorderRef.current = null;
      streamRef.current?.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    },
    [],
  );

  return { speechState, toggleListening, stopListening };
}
