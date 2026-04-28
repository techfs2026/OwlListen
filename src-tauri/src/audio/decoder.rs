use anyhow::{Context, Result};
use ffmpeg_next as ffmpeg;
use ffmpeg_next::{codec, format, frame, media, software::resampling};
use std::sync::Arc;

/// 原始解码样本(deinterleaved,按声道独立存放)
/// 用 Arc 包装以便多个消费者(波形金字塔、放大态视图等)共享,且不阻碍 Drop
#[derive(Debug)]
pub struct RawSamples {
    /// channels[ch] = 该声道的样本序列
    pub channels: Vec<Vec<f32>>,
    pub sample_rate: u32,
}

impl RawSamples {
    pub fn channel_count(&self) -> usize {
        self.channels.len()
    }

    pub fn total_samples_per_channel(&self) -> usize {
        self.channels.first().map(|c| c.len()).unwrap_or(0)
    }
}

/// 解码结果:归一化 [-1.0, 1.0] 的 f32 PCM,按声道分开存放
/// channels.len() ∈ {1, 2}
///   - 单声道源    → channels.len() == 1
///   - 立体声及以上 → channels.len() == 2(>2 声道下混为立体声)
pub struct DecodedAudio {
    pub raw: Arc<RawSamples>,
}

impl DecodedAudio {
    pub fn channel_count(&self) -> usize {
        self.raw.channel_count()
    }

    pub fn sample_rate(&self) -> u32 {
        self.raw.sample_rate
    }

    pub fn samples_per_channel(&self) -> usize {
        self.raw.total_samples_per_channel()
    }

    pub fn duration_secs(&self) -> f64 {
        self.samples_per_channel() as f64 / self.sample_rate() as f64
    }

    /// 便于内部使用:对单声道音频取 channel 0,立体声场景按需取
    pub fn channel(&self, ch: usize) -> Option<&[f32]> {
        self.raw.channels.get(ch).map(|v| v.as_slice())
    }
}

/// 解码任意格式音频文件
/// - 单声道源 → 输出 1 声道
/// - 多声道源 → 输出 2 声道(立体声),>2 声道由 FFmpeg 自动下混
pub fn decode_audio(path: &str, target_sample_rate: u32) -> Result<DecodedAudio> {
    ffmpeg::init().context("Failed to init FFmpeg")?;

    let mut input = format::input(&path)
        .with_context(|| format!("Cannot open file: {path}"))?;

    let stream = input
        .streams()
        .best(media::Type::Audio)
        .context("No audio stream found")?;

    let stream_index = stream.index();
    let codec_params = stream.parameters();

    let codec = codec::Context::from_parameters(codec_params)
        .context("Cannot create codec context")?;
    let mut decoder = codec
        .decoder()
        .audio()
        .context("Cannot open audio decoder")?;

    let src_format = decoder.format();
    let src_rate = decoder.rate();
    let src_layout = decoder.channel_layout();

    // 决定目标声道数:单声道源保持单声道,其余统一为立体声
    let src_channels = src_layout.channels();
    let target_layout = if src_channels <= 1 {
        ffmpeg::channel_layout::ChannelLayout::MONO
    } else {
        ffmpeg::channel_layout::ChannelLayout::STEREO
    };
    let target_channel_count = target_layout.channels() as usize;

    // 重采样器:输出 Planar f32(plane(0)=L, plane(1)=R)
    let mut resampler = resampling::Context::get(
        src_format,
        src_layout,
        src_rate,
        ffmpeg_next::format::Sample::F32(ffmpeg_next::format::sample::Type::Planar),
        target_layout,
        target_sample_rate,
    )
    .context("Cannot create resampler")?;

    // 预分配每声道缓冲
    let estimated = estimate_samples_per_channel(&input, stream_index, target_sample_rate);
    let mut channels: Vec<Vec<f32>> = (0..target_channel_count)
        .map(|_| Vec::with_capacity(estimated))
        .collect();

    let mut decoded_frame = frame::Audio::empty();
    let mut resampled_frame = frame::Audio::empty();

    for (stream, packet) in input.packets() {
        if stream.index() != stream_index {
            continue;
        }
        decoder.send_packet(&packet).ok();

        while decoder.receive_frame(&mut decoded_frame).is_ok() {
            resampler
                .run(&decoded_frame, &mut resampled_frame)
                .context("Resampling failed")?;
            append_planar_samples(&resampled_frame, &mut channels, target_channel_count);
        }
    }

    // flush decoder
    decoder.send_eof().ok();
    while decoder.receive_frame(&mut decoded_frame).is_ok() {
        resampler
            .run(&decoded_frame, &mut resampled_frame)
            .context("Resampling failed")?;
        append_planar_samples(&resampled_frame, &mut channels, target_channel_count);
    }

    // flush resampler
    while resampler.flush(&mut resampled_frame).is_ok() {
        if resampled_frame.samples() == 0 {
            break;
        }
        append_planar_samples(&resampled_frame, &mut channels, target_channel_count);
    }

    log::debug!(
        "Decoded: {} ch × {} samples ({:.2}s) @ {} Hz",
        channels.len(),
        channels.first().map(|c| c.len()).unwrap_or(0),
        channels.first().map(|c| c.len()).unwrap_or(0) as f64 / target_sample_rate as f64,
        target_sample_rate,
    );

    Ok(DecodedAudio {
        raw: Arc::new(RawSamples {
            channels,
            sample_rate: target_sample_rate,
        }),
    })
}

// ── 私有辅助 ─────────────────────────────────────────────────────────────────

fn estimate_samples_per_channel(
    input: &format::context::Input,
    stream_index: usize,
    target_rate: u32,
) -> usize {
    let stream = input.stream(stream_index).unwrap();
    let duration = stream.duration() as f64 * f64::from(stream.time_base());
    if duration > 0.0 {
        (duration * target_rate as f64 * 1.05) as usize
    } else {
        target_rate as usize * 60
    }
}

/// 从 Planar f32 frame 中提取每声道样本,append 到对应 channel buffer
fn append_planar_samples(
    frame: &frame::Audio,
    channels: &mut [Vec<f32>],
    expected_channels: usize,
) {
    let n = frame.samples();
    if n == 0 {
        return;
    }
    for ch in 0..expected_channels {
        // Planar 格式下,plane(ch) 是该声道的连续 f32
        let data = frame.data(ch);
        // SAFETY: planar f32 格式,每 plane 是 n 个连续 f32
        let floats = unsafe { std::slice::from_raw_parts(data.as_ptr() as *const f32, n) };
        channels[ch].extend_from_slice(floats);
    }
}