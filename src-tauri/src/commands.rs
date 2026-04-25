use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::audio::decode_audio;
use crate::waveform::{build_summary, extract_peaks, ViewRange};

// ── AppState ──────────────────────────────────────────────────────────────────

pub struct AppState {
    pub summary: Mutex<Option<crate::waveform::WaveformSummary>>,
    /// 当前加载的音频文件路径（切割时用）
    pub audio_path: Mutex<Option<String>>,
}

impl AppState {
    pub fn new() -> Self {
        Self {
            summary: Mutex::new(None),
            audio_path: Mutex::new(None),
        }
    }
}

// ── 数据类型 ──────────────────────────────────────────────────────────────────

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct AudioInfoDto {
    pub duration: f64,
    pub sample_rate: u32,
    pub level_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct PeakViewDto {
    pub start_sec: f64,
    pub end_sec: f64,
    pub pixel_width: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
pub struct LabelDto {
    pub start: f64,
    pub end: f64,
    pub text: String,
}

// ── 已有命令 ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn load_audio(path: String, state: State<AppState>) -> Result<AudioInfoDto, String> {
    let audio = decode_audio(&path, 22050).map_err(|e| e.to_string())?;
    let summary = build_summary(&audio);

    let dto = AudioInfoDto {
        duration: audio.duration_secs(),
        sample_rate: audio.sample_rate,
        level_count: summary.level_count(),
    };

    *state.summary.lock().unwrap() = Some(summary);
    *state.audio_path.lock().unwrap() = Some(path);

    Ok(dto)
}

#[tauri::command]
pub fn get_peaks(view: PeakViewDto, state: State<AppState>) -> Result<Vec<u8>, String> {
    let guard = state.summary.lock().unwrap();
    let summary = guard.as_ref().ok_or("No audio loaded")?;

    let range = ViewRange {
        start_sec: view.start_sec,
        end_sec: view.end_sec,
        pixel_width: view.pixel_width,
    };

    let peaks = extract_peaks(summary, &range);

    // 序列化为 [f32 as le bytes]：[min0, max0, min1, max1, ...]
    let mut bytes = Vec::with_capacity(peaks.len() * 8);
    for p in &peaks {
        bytes.extend_from_slice(&p.min.to_le_bytes());
        bytes.extend_from_slice(&p.max.to_le_bytes());
    }
    Ok(bytes)
}

#[tauri::command]
pub fn save_labels(labels: Vec<LabelDto>, path: String) -> Result<(), String> {
    use std::io::Write;
    let mut f = std::fs::File::create(&path).map_err(|e| e.to_string())?;
    for l in &labels {
        writeln!(f, "{}\t{}\t{}", l.start, l.end, l.text).map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
pub fn load_labels(path: String) -> Result<Vec<LabelDto>, String> {
    let content = std::fs::read_to_string(&path).map_err(|e| e.to_string())?;
    let mut labels = Vec::new();
    for line in content.lines() {
        let parts: Vec<&str> = line.splitn(3, '\t').collect();
        if parts.len() >= 2 {
            let start: f64 = parts[0].trim().parse().unwrap_or(0.0);
            let end: f64   = parts[1].trim().parse().unwrap_or(0.0);
            let text       = parts.get(2).unwrap_or(&"").trim().to_string();
            labels.push(LabelDto { start, end, text });
        }
    }
    Ok(labels)
}

// ── 新命令：获取临时目录 ───────────────────────────────────────────────────────

#[tauri::command]
pub fn get_temp_dir() -> Result<String, String> {
    let dir = std::env::temp_dir().join("langlisten_segments");
    std::fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok(dir.to_string_lossy().into_owned())
}

// ── 新命令：切割音频 ──────────────────────────────────────────────────────────
//
// 使用 FFmpeg 按 labels 切割出片段，保存为 WAV 格式
// 返回片段文件路径列表

#[tauri::command]
pub fn split_audio(
    audio_path: String,
    labels: Vec<LabelDto>,
    output_dir: String,
) -> Result<Vec<String>, String> {
    // 清理并重建输出目录
    let out_dir = Path::new(&output_dir);
    if out_dir.exists() {
        std::fs::remove_dir_all(out_dir).map_err(|e| e.to_string())?;
    }
    std::fs::create_dir_all(out_dir).map_err(|e| e.to_string())?;

    let mut segment_paths = Vec::with_capacity(labels.len());

    for (i, label) in labels.iter().enumerate() {
        let out_path = out_dir.join(format!("{:04}.wav", i));
        split_segment(&audio_path, label.start, label.end, &out_path)
            .map_err(|e| format!("Segment {i}: {e}"))?;
        segment_paths.push(out_path.to_string_lossy().into_owned());
    }

    Ok(segment_paths)
}

/// 用 FFmpeg 从 [start_sec, end_sec) 提取片段并保存为 WAV
///
/// 策略：全量解码整个文件到 f32 PCM，然后按样本数精确裁剪。
/// 避免 seek + pts 时间戳对齐的所有坑，对于几分钟到几十分钟的音频完全够用。
fn split_segment(
    input_path: &str,
    start_sec: f64,
    end_sec: f64,
    output_path: &Path,
) -> anyhow::Result<()> {
    use anyhow::Context;

    // decode_audio 已经做了全量解码 + 重采样到目标采样率
    // 这里复用它，目标采样率用 16000（Whisper 标准）
    let target_sr: u32 = 16000;
    let audio = crate::audio::decode_audio(input_path, target_sr)
        .with_context(|| format!("decode {input_path}"))?;

    let sr = audio.sample_rate as f64;
    let total = audio.samples.len();

    let start_sample = ((start_sec * sr).round() as usize).min(total);
    let end_sample   = ((end_sec   * sr).round() as usize).min(total);

    log::debug!(
        "split_segment [{:.3}s, {:.3}s] => samples [{}, {}) / {} total",
        start_sec, end_sec, start_sample, end_sample, total
    );

    let slice = &audio.samples[start_sample..end_sample];
    write_wav(output_path, slice, target_sr)?;
    Ok(())
}

/// 写入 16-bit PCM WAV（单声道）
fn write_wav(path: &Path, samples: &[f32], sample_rate: u32) -> anyhow::Result<()> {
    use std::io::{BufWriter, Write};
    use anyhow::Context;

    let pcm: Vec<i16> = samples.iter()
        .map(|&s| (s.clamp(-1.0, 1.0) * 32767.0) as i16)
        .collect();

    let data_len = (pcm.len() * 2) as u32;
    let mut f = BufWriter::new(std::fs::File::create(path).context("create wav")?);

    // RIFF header
    f.write_all(b"RIFF")?;
    f.write_all(&(data_len + 36).to_le_bytes())?;
    f.write_all(b"WAVE")?;
    // fmt chunk
    f.write_all(b"fmt ")?;
    f.write_all(&16u32.to_le_bytes())?;    // chunk size
    f.write_all(&1u16.to_le_bytes())?;     // PCM
    f.write_all(&1u16.to_le_bytes())?;     // mono
    f.write_all(&sample_rate.to_le_bytes())?;
    f.write_all(&(sample_rate * 2).to_le_bytes())?; // byte rate
    f.write_all(&2u16.to_le_bytes())?;     // block align
    f.write_all(&16u16.to_le_bytes())?;    // bits per sample
    // data chunk
    f.write_all(b"data")?;
    f.write_all(&data_len.to_le_bytes())?;
    for s in &pcm {
        f.write_all(&s.to_le_bytes())?;
    }

    Ok(())
}

// ── 新命令：Whisper 转写 ──────────────────────────────────────────────────────
//
// 依赖：whisper-rs crate（绑定 whisper.cpp），模型文件从本地加载
// 若未安装模型，返回空字符串（不 panic）

#[tauri::command]
pub fn transcribe_segments(
    segment_paths: Vec<String>,
    model: String,
) -> Result<Vec<String>, String> {
    use whisper_rs::{WhisperContext, WhisperContextParameters};

    // 模型路径：~/.cache/whisper/ggml-{model}.bin
    let model_path = model_path_for(&model);
    if !model_path.exists() {
        return Err(format!(
            "Whisper 模型文件不存在：{}\n请运行 scripts/download_model.sh {} 下载",
            model_path.display(), model
        ));
    }

    let ctx = WhisperContext::new_with_params(
        model_path.to_str().ok_or("model path is not valid UTF-8")?,
        WhisperContextParameters::default(),
    ).map_err(|e| format!("Load whisper model: {e}"))?;

    let mut results = Vec::with_capacity(segment_paths.len());

    for path in &segment_paths {
        let text = transcribe_one(&ctx, path)
            .unwrap_or_else(|e| {
                log::warn!("Transcribe {path} failed: {e}");
                String::new()
            });
        results.push(text);
    }

    Ok(results)
}

fn model_path_for(model: &str) -> PathBuf {
    // 开发期：可执行文件在 src-tauri/target/...，向上找到项目根目录
    // 生产期：tauri 打包后可执行文件旁边就是资源目录，保持同样的相对结构
    let exe_dir = std::env::current_exe()
        .ok()
        .and_then(|p| p.parent().map(PathBuf::from))
        .unwrap_or_else(|| PathBuf::from("."));

    // 开发期路径：src-tauri/target/{profile}/ → 上溯三级到项目根
    // 尝试几个候选路径，取第一个存在的
    let candidates = [
        exe_dir.join("../../../whisper-models"),   // 开发期
        exe_dir.join("../../whisper-models"),       // 打包后 macOS bundle
        PathBuf::from("whisper-models"),            // 兜底：当前工作目录
    ];

    let base_dir = candidates
        .iter()
        .find(|p| p.exists())
        .cloned()
        .unwrap_or_else(|| exe_dir.join("../../../whisper-models"));

    base_dir.join(format!("ggml-{model}.en.bin"))
}

fn transcribe_one(
    ctx: &whisper_rs::WhisperContext,
    wav_path: &str,
) -> anyhow::Result<String> {
    use anyhow::Context;
    use whisper_rs::{FullParams, SamplingStrategy};

    // 读取 WAV → f32 样本
    let samples = read_wav_f32(wav_path).context("read wav")?;

    let mut state = ctx.create_state().context("create state")?;
    let mut params = FullParams::new(SamplingStrategy::Greedy { best_of: 1 });
    params.set_language(Some("en"));  // 英语精听场景，固定英语
    params.set_print_special(false);
    params.set_print_progress(false);
    params.set_print_realtime(false);
    params.set_print_timestamps(false);

    state.full(params, &samples).context("whisper full")?;

    let n_segs = state.full_n_segments();
    let mut text = String::new();
    for i in 0..n_segs {
        if let Some(seg) = state.get_segment(i) {
            text.push_str(seg.to_str_lossy().unwrap_or_default().trim());
            text.push(' ');
        }
    }

    Ok(text.trim().to_string())
}

fn read_wav_f32(path: &str) -> anyhow::Result<Vec<f32>> {
    use anyhow::Context;
    use std::io::{BufReader, Read, Seek, SeekFrom};

    let mut f = BufReader::new(std::fs::File::open(path).context("open wav")?);

    // 跳过 WAV header（44 字节标准 PCM header）
    f.seek(SeekFrom::Start(44)).context("seek wav data")?;

    let mut buf = Vec::new();
    f.read_to_end(&mut buf).context("read wav")?;

    let samples: Vec<f32> = buf
        .chunks_exact(2)
        .map(|c| i16::from_le_bytes([c[0], c[1]]) as f32 / 32768.0)
        .collect();

    Ok(samples)
}

// ── 新命令：打包 ZIP ──────────────────────────────────────────────────────────
//
// metadata.json 格式：
// {
//   "version": 1,
//   "segments": [
//     {
//       "index": 0,
//       "audio": "segments/0000.wav",
//       "start": 1.23,
//       "end": 4.56,
//       "text": "Hello world",
//       "label": "用户备注"
//     }, ...
//   ]
// }

#[derive(Serialize)]
struct MetadataSegment {
    index: usize,
    audio: String,
    start: f64,
    end: f64,
    text: String,
    label: String,
}

#[derive(Serialize)]
struct Metadata {
    version: u32,
    segments: Vec<MetadataSegment>,
}

#[tauri::command]
pub fn build_zip(
    segment_paths: Vec<String>,
    labels: Vec<LabelDto>,
    transcriptions: Vec<String>,
    output_path: String,
) -> Result<(), String> {
    use std::io::{Read, Write};
    use zip::{write::FileOptions, CompressionMethod, ZipWriter};

    let file = std::fs::File::create(&output_path).map_err(|e| e.to_string())?;
    let mut zip = ZipWriter::new(file);
    let opts: FileOptions<()> = FileOptions::default()
        .compression_method(CompressionMethod::Deflated)
        .unix_permissions(0o644);

    // 构建 metadata
    let segments: Vec<MetadataSegment> = segment_paths
        .iter()
        .enumerate()
        .map(|(i, _)| MetadataSegment {
            index: i,
            audio: format!("segments/{:04}.wav", i),
            start: labels.get(i).map(|l| l.start).unwrap_or(0.0),
            end:   labels.get(i).map(|l| l.end).unwrap_or(0.0),
            text:  transcriptions.get(i).cloned().unwrap_or_default(),
            label: labels.get(i).map(|l| l.text.clone()).unwrap_or_default(),
        })
        .collect();

    let metadata = Metadata { version: 1, segments };
    let json = serde_json::to_string_pretty(&metadata).map_err(|e| e.to_string())?;

    // 写入 metadata.json
    zip.start_file("metadata.json", opts).map_err(|e| e.to_string())?;
    zip.write_all(json.as_bytes()).map_err(|e| e.to_string())?;

    // 写入每个音频片段
    for (i, seg_path) in segment_paths.iter().enumerate() {
        let file_name = format!("segments/{:04}.wav", i);
        zip.start_file(&file_name, opts).map_err(|e| e.to_string())?;

        let mut seg_file = std::fs::File::open(seg_path)
            .map_err(|e| format!("Open segment {seg_path}: {e}"))?;
        let mut buf = Vec::new();
        seg_file.read_to_end(&mut buf).map_err(|e| e.to_string())?;
        zip.write_all(&buf).map_err(|e| e.to_string())?;
    }

    zip.finish().map_err(|e| e.to_string())?;
    Ok(())
}

// ── 新命令：在 Finder/Explorer 中显示文件 ────────────────────────────────────

#[tauri::command]
pub fn reveal_in_finder(path: String) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .args(["-R", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .args(["/select,", &path])
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    #[cfg(target_os = "linux")]
    {
        // xdg-open 打开所在目录
        let parent = Path::new(&path)
            .parent()
            .map(|p| p.to_string_lossy().into_owned())
            .unwrap_or(path);
        std::process::Command::new("xdg-open")
            .arg(&parent)
            .spawn()
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}