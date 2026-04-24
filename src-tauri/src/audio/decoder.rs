use anyhow::{Context, Result};
use ffmpeg_next as ffmpeg;
use ffmpeg_next::{codec, format, frame, media, software::resampling};

/// 解码结果：归一化 [-1.0, 1.0] 的 f32 单声道 PCM
pub struct DecodedAudio {
    pub samples: Vec<f32>,
    pub sample_rate: u32,
}

impl DecodedAudio {
    pub fn duration_secs(&self) -> f64 {
        self.samples.len() as f64 / self.sample_rate as f64
    }
}

/// 解码任意格式音频文件到 f32 单声道
/// 在 rayon 线程池中调用是安全的（FFmpeg context 不跨线程共享）
pub fn decode_audio(path: &str, target_sample_rate: u32) -> Result<DecodedAudio> {
    ffmpeg::init().context("Failed to init FFmpeg")?;

    let mut input = format::input(&path)
        .with_context(|| format!("Cannot open file: {path}"))?;

    // 找最佳音频流
    let stream = input
        .streams()
        .best(media::Type::Audio)
        .context("No audio stream found")?;

    let stream_index = stream.index();
    let codec_params = stream.parameters();

    // 解码器
    let codec = codec::Context::from_parameters(codec_params)
        .context("Cannot create codec context")?;
    let mut decoder = codec
        .decoder()
        .audio()
        .context("Cannot open audio decoder")?;

    // 重采样：任意格式 → f32 单声道
    let src_format = decoder.format();
    let src_rate   = decoder.rate();
    let src_layout = decoder.channel_layout();

    let mut resampler = resampling::Context::get(
        src_format,
        src_layout,
        src_rate,
        ffmpeg_next::format::Sample::F32(ffmpeg_next::format::sample::Type::Packed),
        ffmpeg_next::channel_layout::ChannelLayout::MONO,
        target_sample_rate,
    )
    .context("Cannot create resampler")?;

    // 预分配：估算总样本数
    let estimated = estimate_samples(&input, stream_index, target_sample_rate);
    let mut samples: Vec<f32> = Vec::with_capacity(estimated);

    // 解码循环
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
            append_f32_samples(&resampled_frame, &mut samples);
        }
    }

    // flush decoder
    decoder.send_eof().ok();
    while decoder.receive_frame(&mut decoded_frame).is_ok() {
        resampler
            .run(&decoded_frame, &mut resampled_frame)
            .context("Resampling failed")?;
        append_f32_samples(&resampled_frame, &mut samples);
    }

    // flush resampler
    while resampler.flush(&mut resampled_frame).is_ok() {
        if resampled_frame.samples() == 0 {
            break;
        }
        append_f32_samples(&resampled_frame, &mut samples);
    }

    log::debug!(
        "Decoded: {} samples, {:.2}s",
        samples.len(),
        samples.len() as f64 / target_sample_rate as f64
    );

    Ok(DecodedAudio {
        samples,
        sample_rate: target_sample_rate,
    })
}

// ── 私有辅助 ─────────────────────────────────────────────────────────────────

fn estimate_samples(
    input: &format::context::Input,
    stream_index: usize,
    target_rate: u32,
) -> usize {
    let stream = input.stream(stream_index).unwrap();
    let duration = stream.duration() as f64 * f64::from(stream.time_base());
    if duration > 0.0 {
        (duration * target_rate as f64 * 1.05) as usize
    } else {
        target_rate as usize * 60 // 默认预留 1 分钟
    }
}

fn append_f32_samples(frame: &frame::Audio, out: &mut Vec<f32>) {
    if frame.samples() == 0 {
        return;
    }
    // plane(0) 是单声道 packed f32 数据
    let data = frame.data(0);
    // SAFETY: f32 packed 格式，每 4 字节一个样本
    let n = frame.samples();
    let floats = unsafe {
        std::slice::from_raw_parts(data.as_ptr() as *const f32, n)
    };
    out.extend_from_slice(floats);
}
