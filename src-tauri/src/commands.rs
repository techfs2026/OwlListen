use std::sync::Mutex;
use tauri::State;
use serde::{Deserialize, Serialize};
use anyhow::Result;

use crate::audio::decode_audio;
use crate::waveform::{build_summary, extract_peaks, ViewRange, WaveformSummary};

// ── 全局状态：已加载的 Summary ────────────────────────────────────────────────

pub struct AppState {
    pub summary: Mutex<Option<WaveformSummary>>,
}

impl AppState {
    pub fn new() -> Self {
        Self { summary: Mutex::new(None) }
    }
}

// ── 响应类型 ──────────────────────────────────────────────────────────────────

#[derive(Serialize)]
pub struct AudioInfo {
    pub duration: f64,
    pub sample_rate: u32,
    pub level_count: usize,
}

#[derive(Deserialize)]
pub struct ViewRangeParams {
    pub start_sec: f64,
    pub end_sec: f64,
    pub pixel_width: usize,
}

// ── Commands ──────────────────────────────────────────────────────────────────

/// 加载音频：解码 + 构建峰值金字塔
/// 返回 AudioInfo（时长、采样率、层数）
/// 峰值数据保存在 AppState，不在这里返回（可能很大）
#[tauri::command]
pub async fn load_audio(
    path: String,
    state: State<'_, AppState>,
) -> Result<AudioInfo, String> {
    // 解码（阻塞，在 async 里用 spawn_blocking）
    let audio = tauri::async_runtime::spawn_blocking(move || {
        decode_audio(&path, 44100)
    })
    .await
    .map_err(|e| e.to_string())?
    .map_err(|e| e.to_string())?;

    let info = AudioInfo {
        duration: audio.duration_secs(),
        sample_rate: audio.sample_rate,
        level_count: 0, // 构建完后更新
    };

    // 构建峰值金字塔（CPU 密集，spawn_blocking）
    let summary = tauri::async_runtime::spawn_blocking(move || {
        build_summary(&audio)
    })
    .await
    .map_err(|e| e.to_string())?;

    let level_count = summary.level_count();
    *state.summary.lock().unwrap() = Some(summary);

    Ok(AudioInfo { level_count, ..info })
}

/// 获取当前视图的峰值数据
/// 返回二进制 ArrayBuffer：[min0, max0, min1, max1, ...] f32 little-endian
/// 前端直接用 Float32Array 接收，零拷贝喂给 WebGL
#[tauri::command]
pub fn get_peaks(
    view: ViewRangeParams,
    state: State<'_, AppState>,
) -> Result<Vec<u8>, String> {
    let guard = state.summary.lock().unwrap();
    let summary = guard.as_ref().ok_or("No audio loaded")?;

    let view_range = ViewRange {
        start_sec:   view.start_sec,
        end_sec:     view.end_sec,
        pixel_width: view.pixel_width,
    };

    let peaks = extract_peaks(summary, &view_range);

    // 转为 &[u8]：Peak 是 #[repr(C)]，[f32; 2] 内存布局
    // SAFETY: Peak = [f32; 2]，对齐和大小都正确
    let bytes = unsafe {
        std::slice::from_raw_parts(
            peaks.as_ptr() as *const u8,
            peaks.len() * std::mem::size_of::<crate::waveform::Peak>(),
        )
    };

    Ok(bytes.to_vec())
}

/// 保存标记到 labels.txt（Audacity 兼容格式）
#[derive(Deserialize)]
pub struct LabelData {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[tauri::command]
pub fn save_labels(
    labels: Vec<LabelData>,
    path: String,
) -> Result<(), String> {
    use std::io::Write;
    let mut file = std::fs::File::create(&path)
        .map_err(|e| e.to_string())?;

    for label in &labels {
        writeln!(
            file,
            "{:.6}\t{:.6}\t{}",
            label.start, label.end, label.text
        )
        .map_err(|e| e.to_string())?;
    }

    Ok(())
}

/// 加载 labels.txt
#[derive(Serialize)]
pub struct LabelResult {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

#[tauri::command]
pub fn load_labels(path: String) -> Result<Vec<LabelResult>, String> {
    let content = std::fs::read_to_string(&path)
        .map_err(|e| e.to_string())?;

    let labels = content
        .lines()
        .filter(|l| !l.trim().is_empty())
        .filter_map(|line| {
            let parts: Vec<&str> = line.splitn(3, '\t').collect();
            if parts.len() < 2 { return None; }
            Some(LabelResult {
                start: parts[0].parse().ok()?,
                end:   parts[1].parse().ok()?,
                text:  parts.get(2).unwrap_or(&"").to_string(),
            })
        })
        .collect();

    Ok(labels)
}
