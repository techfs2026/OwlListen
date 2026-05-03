use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::{Deserialize, Serialize};
use tauri::State;

use crate::audio::decode_audio;
use crate::waveform::{self, builder, ViewRange};
use crate::audiobook::{parse_audiobook, AudiobookMeta};
use crate::audiobook::{get_progress, set_progress, BookProgress};


use tauri::AppHandle;
use tauri::Manager;

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
#[serde(rename_all = "camelCase")]
pub struct AudioInfoDto {
    pub duration: f64,
    pub sample_rate: u32,
    pub level_count: usize,
    pub channel_count: usize,
}

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
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

// ── 渲染数据 DTO（与前端 RenderData 一一对应）─────────────────────────────────
//
// mode 决定 channels 里每个元素的形状:
//   "envelope" → ChannelEnvelope { peaks: [{min, max, rms}, ...] }
//   "polyline" / "stem" → ChannelPolyline { points: [[x, y], ...] }
//
// 用 internally tagged enum,前端 JSON 看起来是:
//   { "kind": "envelope", "peaks": [...] }

#[derive(Debug, Serialize)]
#[serde(tag = "kind", rename_all = "lowercase")]
pub enum ChannelDataDto {
    Envelope { peaks: Vec<PeakDto> },
    Polyline { points: Vec<[f32; 2]> },
    Stem     { points: Vec<[f32; 2]> },
}

#[derive(Debug, Serialize)]
pub struct PeakDto {
    pub min: f32,
    pub max: f32,
    pub rms: f32,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderDataDto {
    /// "envelope" | "polyline" | "stem"
    pub mode: &'static str,
    pub channels: Vec<ChannelDataDto>,
    pub pixel_width: usize,
}

// ── 已有命令 ──────────────────────────────────────────────────────────────────

#[tauri::command]
pub fn load_audio(path: String, state: State<AppState>) -> Result<AudioInfoDto, String> {
    let audio = decode_audio(&path, 22050).map_err(|e| e.to_string())?;
    let summary = builder::build_summary(&audio);

    let dto = AudioInfoDto {
        duration: audio.duration_secs(),
        sample_rate: audio.sample_rate(),
        level_count: summary.level_count(),
        channel_count: audio.channel_count(),
    };

    *state.summary.lock().unwrap() = Some(summary);
    *state.audio_path.lock().unwrap() = Some(path);

    Ok(dto)
}

#[tauri::command]
pub fn get_peaks(view: PeakViewDto, state: State<AppState>) -> Result<RenderDataDto, String> {
    let guard = state.summary.lock().unwrap();
    let summary = guard.as_ref().ok_or("No audio loaded")?;

    let range = ViewRange {
        start_sec: view.start_sec,
        end_sec: view.end_sec,
        pixel_width: view.pixel_width,
    };

    let render = waveform::extract(summary, &range);

    // 转成 DTO
    let mode_str = match render.mode {
        waveform::RenderMode::Envelope => "envelope",
        waveform::RenderMode::Polyline => "polyline",
        waveform::RenderMode::Stem => "stem",
    };

    let channels: Vec<ChannelDataDto> = render
        .channels
        .into_iter()
        .map(|ch| match ch {
            waveform::ChannelRenderData::Envelope(peaks) => ChannelDataDto::Envelope {
                peaks: peaks
                    .into_iter()
                    .map(|p| PeakDto { min: p.min, max: p.max, rms: p.rms })
                    .collect(),
            },
            waveform::ChannelRenderData::Polyline(pts) => ChannelDataDto::Polyline {
                points: pts.into_iter().map(|(x, y)| [x, y]).collect(),
            },
            waveform::ChannelRenderData::Stem(pts) => ChannelDataDto::Stem {
                points: pts.into_iter().map(|(x, y)| [x, y]).collect(),
            },
        })
        .collect();

    Ok(RenderDataDto {
        mode: mode_str,
        channels,
        pixel_width: view.pixel_width,
    })
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
// 使用 FFmpeg 按 labels 切割出片段，保存为 MP3 格式
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

    // 一次性解码 + 下混到 mono（Whisper 要 mono / 16 kHz）
    // 之前每个 label 都重新解码整个文件，N 段 = N 次全量解码
    let target_sr: u32 = 16000;
    let audio = crate::audio::decode_audio(&audio_path, target_sr)
        .map_err(|e| format!("decode {audio_path}: {e}"))?;
    let sr = audio.sample_rate() as f64;
    let mono = downmix_to_mono(&audio);
    let total = mono.len();

    let mut segment_paths = Vec::with_capacity(labels.len());

    for (i, label) in labels.iter().enumerate() {
        let out_path = out_dir.join(format!("{:04}.mp3", i));
        let start_sample = ((label.start * sr).round() as usize).min(total);
        let end_sample = ((label.end * sr).round() as usize).min(total).max(start_sample);

        log::debug!(
            "split_segment[{}] [{:.3}s, {:.3}s] => samples [{}, {}) / {} total",
            i, label.start, label.end, start_sample, end_sample, total
        );

        let slice = &mono[start_sample..end_sample];
        write_mp3(&out_path, slice, target_sr)
            .map_err(|e| format!("Segment {i}: {e}"))?;
        segment_paths.push(out_path.to_string_lossy().into_owned());
    }

    Ok(segment_paths)
}

/// 把 DecodedAudio 的多个声道下混到单声道(立体声 → 平均)
/// 单声道直接克隆返回,立体声 (L+R)/2
fn downmix_to_mono(audio: &crate::audio::DecodedAudio) -> Vec<f32> {
    let channels = audio.channel_count();
    if channels == 1 {
        return audio.channel(0).expect("ch 0").to_vec();
    }
    // 立体声 / 多声道:逐样本均值
    let len = audio.samples_per_channel();
    let mut out = Vec::with_capacity(len);
    let inv = 1.0 / channels as f32;
    for i in 0..len {
        let mut sum = 0.0_f32;
        for ch in 0..channels {
            sum += audio.channel(ch).expect("ch in range")[i];
        }
        out.push(sum * inv);
    }
    out
}

/// 将 f32 PCM 样本编码为 MP3 并写入文件（ffmpeg-next / libmp3lame）
fn write_mp3(path: &Path, samples: &[f32], sample_rate: u32) -> anyhow::Result<()> {
    use anyhow::Context;
    use ffmpeg_next as ffmpeg;
    use ffmpeg::util::frame::audio::Audio as AudioFrame;
    use ffmpeg::format::Sample;
    use ffmpeg::format::sample::Type as SampleType;
    use ffmpeg::ChannelLayout;

    ffmpeg::init().context("ffmpeg init")?;

    // ── 输出容器 ──────────────────────────────────────────────────────────────
    let mut octx = ffmpeg::format::output(&path).context("open output")?;

    // ── 编码器：libmp3lame ────────────────────────────────────────────────────
    // ffmpeg-next 现代 API：编码器从 codec::context::Context 独立构建，
    // open 之后再 add_stream 并用 set_parameters 把参数写入容器。
    let codec = ffmpeg::encoder::find_by_name("libmp3lame")
        .context("libmp3lame not found — ffmpeg built without MP3 support?")?;

    let mut encoder = {
        let ctx = ffmpeg::codec::context::Context::new_with_codec(codec);
        let mut enc = ctx.encoder().audio().context("get audio encoder")?;
        enc.set_rate(sample_rate as i32);
        enc.set_channel_layout(ChannelLayout::MONO);
        enc.set_format(Sample::F32(SampleType::Planar));
        enc.set_bit_rate(64_000); // 64 kbps，精听场景足够
        enc.set_time_base((1, sample_rate as i32));
        enc.open_as(codec).context("open encoder")?
    };

    // 编码器 open 后把参数写入输出流
    let mut stream = octx.add_stream(ffmpeg::codec::Id::None).context("add stream")?;
    stream.set_parameters(&encoder);
    stream.set_time_base((1, sample_rate as i32));

    octx.write_header().context("write header")?;

    // ── 按 frame_size 分块送帧 ────────────────────────────────────────────────
    // libmp3lame 固定帧大小 1152 样本；最后一块不足时补零
    let frame_size = encoder.frame_size() as usize;
    let mut pts: i64 = 0;
    let mut offset = 0;

    while offset < samples.len() {
        let chunk_end = (offset + frame_size).min(samples.len());
        let chunk = &samples[offset..chunk_end];
        offset = chunk_end;

        let mut frame = AudioFrame::new(
            Sample::F32(SampleType::Planar),
            frame_size, // 始终分配完整帧，不足部分保持零
            ChannelLayout::MONO,
        );
        frame.set_rate(sample_rate);
        frame.set_pts(Some(pts));
        pts += chunk.len() as i64;

        // 写入样本到 plane 0
        let plane: &mut [f32] = unsafe {
            std::slice::from_raw_parts_mut(
                frame.data_mut(0).as_mut_ptr() as *mut f32,
                frame_size,
            )
        };
        plane[..chunk.len()].copy_from_slice(chunk);
        // 不足 frame_size 的尾部已由 AudioFrame::new 零初始化

        mp3_send_frame(&mut encoder, &mut octx, Some(&frame))?;
    }

    // ── flush 编码器 ──────────────────────────────────────────────────────────
    mp3_send_frame(&mut encoder, &mut octx, None)?;
    octx.write_trailer().context("write trailer")?;
    Ok(())
}

/// 送一帧（或 EOF）并把所有就绪的包写入容器
fn mp3_send_frame(
    encoder: &mut ffmpeg_next::codec::encoder::audio::Audio,
    octx:    &mut ffmpeg_next::format::context::Output,
    frame:   Option<&ffmpeg_next::util::frame::audio::Audio>,
) -> anyhow::Result<()> {
    use anyhow::Context;
    use ffmpeg_next::Error;

    match frame {
        Some(f) => encoder.send_frame(f).context("send_frame")?,
        None    => encoder.send_eof().context("send_eof")?,
    }

    let mut pkt = ffmpeg_next::Packet::empty();
    loop {
        match encoder.receive_packet(&mut pkt) {
            Ok(()) => { pkt.write_interleaved(octx).context("write packet")?; }
            Err(Error::Other { errno }) if errno == ffmpeg_next::error::EAGAIN => break,
            Err(Error::Eof)  => break,
            Err(e) => return Err(anyhow::anyhow!(e)).context("receive_packet"),
        }
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

    // 用 decode_audio 解码（支持 MP3 / WAV / 任意 ffmpeg 格式），重采样到 16000 Hz
    let audio = crate::audio::decode_audio(wav_path, 16000)
        .with_context(|| format!("decode {wav_path}"))?;
    // Whisper 要 mono;如果切片是立体声(理论上 split_segment 已经下混,但 transcribe
    // 也允许独立调用),这里再下混一次保证安全
    let samples = downmix_to_mono(&audio);

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
            audio: format!("segments/{:04}.mp3", i),
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
        let file_name = format!("segments/{:04}.mp3", i);
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

/// 解析有声书元数据（章节列表、书名、作者、时长）
#[tauri::command]
pub fn load_audiobook(path: String) -> Result<AudiobookMeta, String> {
    parse_audiobook(&path).map_err(|e| e.to_string())
}
 
/// 读取播放进度
#[tauri::command]
pub fn get_audiobook_progress(
    app: AppHandle,
    book_path: String,
) -> BookProgress {
    let dir = app_data_dir(&app);
    get_progress(&dir, &book_path)
}
 
/// 保存播放进度（每隔几秒调用一次即可）
#[tauri::command]
pub fn save_audiobook_progress(
    app: AppHandle,
    book_path: String,
    chapter_index: usize,
    position_sec: f64,
) -> Result<(), String> {
    let dir = app_data_dir(&app);
    set_progress(
        &dir,
        &book_path,
        BookProgress { chapter_index, position_sec },
    )
    .map_err(|e| e.to_string())
}
 
fn app_data_dir(app: &AppHandle) -> String {
    app.path()
        .app_data_dir()
        .unwrap_or_default()
        .to_string_lossy()
        .to_string()
}