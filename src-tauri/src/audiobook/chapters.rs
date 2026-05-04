use anyhow::{Context, Result};
use ffmpeg_next as ffmpeg;
use ffmpeg_next::ffi;
use serde::{Deserialize, Serialize};
use std::os::raw::c_int;

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Chapter {
    pub index: usize,
    pub title: String,
    pub start_sec: f64,
    pub end_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AudiobookMeta {
    pub title: String,
    pub author: String,
    pub duration_sec: f64,
    pub chapters: Vec<Chapter>,
}

pub fn parse_audiobook(path: &str) -> Result<AudiobookMeta> {
    ffmpeg::init().context("FFmpeg init failed")?;

    let input = ffmpeg::format::input(&path)
        .with_context(|| format!("Cannot open: {path}"))?;

    let duration_sec = input.duration() as f64 / ffmpeg::ffi::AV_TIME_BASE as f64;

    let meta = input.metadata();
    let title = meta
        .get("title")
        .unwrap_or_else(|| {
            std::path::Path::new(path)
                .file_stem()
                .and_then(|s| s.to_str())
                .unwrap_or("未知书名")
        })
        .to_string();
    let author = meta
        .get("artist")
        .or_else(|| meta.get("album_artist"))
        .or_else(|| meta.get("author"))
        .unwrap_or("")
        .to_string();

    let raw_chapters = input.chapters();
    let chapters: Vec<Chapter> = if raw_chapters.len() == 0 {
        vec![Chapter {
            index: 0,
            title: title.clone(),
            start_sec: 0.0,
            end_sec: duration_sec,
        }]
    } else {
        raw_chapters
            .enumerate()
            .map(|(i, ch)| {
                let tb = ch.time_base();
                let tb_f = tb.numerator() as f64 / tb.denominator() as f64;
                let start_sec = ch.start() as f64 * tb_f;
                let end_sec   = ch.end()   as f64 * tb_f;
                let ch_title = ch
                    .metadata()
                    .get("title")
                    .unwrap_or(&format!("第 {} 章", i + 1))
                    .to_string();
                Chapter { index: i, title: ch_title, start_sec, end_sec }
            })
            .collect()
    };

    Ok(AudiobookMeta { title, author, duration_sec, chapters })
}

// ── ADTS header 工具 ──────────────────────────────────────────────────────────
//
// AAC 在 m4b/mp4 容器里是 "raw" 格式（无同步头），浏览器的 decodeAudioData
// 需要 ADTS 流。我们逐 packet 加 7 字节 ADTS header 即可，无需解码/重编码。
//
// AudioSpecificConfig (extradata, 2 字节) bit 布局：
//   AAAAA BBBB CCCC D000
//   A: profile (object_type) - 1
//   B: sample_rate_index
//   C: channel_config
//   D: 其他 flags（忽略）

#[derive(Clone, Copy)]
struct AdtsParams {
    profile: u8,           // 0=Main, 1=LC, 2=SSR (ADTS 格式里是 object_type-1)
    sample_rate_index: u8, // 0..=12
    channel_config: u8,    // 1..=7
}

fn parse_audio_specific_config(extradata: &[u8]) -> Result<AdtsParams> {
    if extradata.len() < 2 {
        anyhow::bail!("AAC extradata too short: {} bytes", extradata.len());
    }
    let b0 = extradata[0];
    let b1 = extradata[1];
    let object_type = b0 >> 3;                                  // 5 bits
    let sample_rate_index = ((b0 & 0x07) << 1) | (b1 >> 7);     // 4 bits
    let channel_config = (b1 >> 3) & 0x0F;                       // 4 bits

    if object_type == 0 || object_type > 4 {
        anyhow::bail!("Unsupported AAC object type: {}", object_type);
    }
    if sample_rate_index > 12 {
        anyhow::bail!("Unsupported sample_rate_index: {}", sample_rate_index);
    }
    if channel_config == 0 || channel_config > 7 {
        anyhow::bail!("Unsupported channel_config: {}", channel_config);
    }

    Ok(AdtsParams {
        profile: object_type - 1,
        sample_rate_index,
        channel_config,
    })
}

/// 写 7 字节 ADTS header 到 out。frame_len 是 payload 长度（不含 header）。
fn write_adts_header(out: &mut Vec<u8>, params: AdtsParams, frame_len: usize) {
    let total_len = frame_len + 7; // ADTS header 固定 7 字节（无 CRC）
    debug_assert!(total_len < (1 << 13), "AAC frame too large for ADTS");

    // syncword 0xFFF + ID(0=MPEG-4) + layer(0) + protection_absent(1)
    out.push(0xFF);
    out.push(0xF1);
    // profile(2) | sample_rate_index(4) | private(1) | channel_config_high(1)
    out.push(
        (params.profile << 6)
            | (params.sample_rate_index << 2)
            | ((params.channel_config >> 2) & 0x01),
    );
    // channel_config_low(2) | original(1) | home(1) | copyright_id(1) | copyright_start(1)
    // | aac_frame_length_high(2)
    out.push(
        ((params.channel_config & 0x03) << 6)
            | (((total_len >> 11) & 0x03) as u8),
    );
    // aac_frame_length_mid(8)
    out.push(((total_len >> 3) & 0xFF) as u8);
    // aac_frame_length_low(3) | adts_buffer_fullness_high(5) (0x1F = VBR)
    out.push((((total_len & 0x07) << 5) | 0x1F) as u8);
    // adts_buffer_fullness_low(6) | num_raw_data_blocks(2, 0=1 block)
    out.push(0xFC);
}

// ── export_chapter_slice (remux 路径) ─────────────────────────────────────────
//
// 完全不解码、不重采样、不重编码：
//   1. 打开 m4b 输入
//   2. 从 audio stream 的 extradata 解析 AAC 参数
//   3. seek 到 start_sec
//   4. 逐 packet 读取，丢弃 pts < start_sec 的，加 ADTS header 后写入 buffer
//   5. pts >= end_sec 时停止
//
// 一章 30 分钟在 SSD 上通常 < 100ms 完成。
pub fn export_chapter_slice(path: &str, start_sec: f64, end_sec: f64) -> Result<Vec<u8>> {
    ffmpeg::init().context("FFmpeg init")?;

    let mut ictx = ffmpeg::format::input(&path)
        .with_context(|| format!("Cannot open: {path}"))?;

    let stream = ictx
        .streams()
        .best(ffmpeg::media::Type::Audio)
        .ok_or_else(|| anyhow::anyhow!("No audio stream found in: {path}"))?;
    let audio_stream_idx = stream.index();

    // 校验是 AAC（m4b 必然是，但保险起见）
    let codec_id = stream.parameters().id();
    if codec_id != ffmpeg::codec::Id::AAC {
        anyhow::bail!(
            "Remux path only supports AAC (got {:?}). m4b expected.",
            codec_id
        );
    }

    let in_tb = stream.time_base();
    let in_tb_f = in_tb.numerator() as f64 / in_tb.denominator() as f64;

    // 从 extradata 解析 AudioSpecificConfig
    // ffmpeg-next 没暴露 extradata 的安全 API，走 ffi
    let extradata: Vec<u8> = unsafe {
        let par = stream.parameters().as_ptr();
        let size = (*par).extradata_size as usize;
        if size == 0 || (*par).extradata.is_null() {
            anyhow::bail!("AAC stream has no extradata; cannot build ADTS header");
        }
        std::slice::from_raw_parts((*par).extradata, size).to_vec()
    };
    let adts = parse_audio_specific_config(&extradata)?;

    drop(stream); // 释放对 ictx 的不可变借用，下面要可变借用

    // ── seek 到 start_sec ─────────────────────────────────────────────────────
    let seek_ts = (start_sec / in_tb_f) as i64;
    unsafe {
        let ret = ffi::av_seek_frame(
            ictx.as_mut_ptr(),
            audio_stream_idx as c_int,
            seek_ts,
            ffi::AVSEEK_FLAG_BACKWARD as c_int,
        );
        if ret < 0 {
            anyhow::bail!("av_seek_frame failed (code {})", ret);
        }
    }

    // ── 预分配输出 buffer ─────────────────────────────────────────────────────
    // m4b 一般 64-128 kbps，留一点余量
    let duration_secs = (end_sec - start_sec).max(0.0);
    let estimated_bytes = (duration_secs * 20_000.0) as usize + 4096;
    let mut out: Vec<u8> = Vec::with_capacity(estimated_bytes);

    // ── 逐 packet remux ──────────────────────────────────────────────────────
    for (s, packet) in ictx.packets() {
        if s.index() != audio_stream_idx {
            continue;
        }
        let pts = match packet.pts() {
            Some(p) => p,
            None => continue,
        };
        let pkt_sec = pts as f64 * in_tb_f;

        // seek backward 可能落在 start_sec 之前，丢掉早于目标的 packet
        // AAC 每个 packet 解码独立（无帧间依赖），可以安全丢
        if pkt_sec < start_sec {
            continue;
        }
        if pkt_sec >= end_sec {
            break;
        }

        let data = match packet.data() {
            Some(d) if !d.is_empty() => d,
            _ => continue,
        };

        write_adts_header(&mut out, adts, data.len());
        out.extend_from_slice(data);
    }

    if out.is_empty() {
        anyhow::bail!(
            "remux produced no output for [{:.2}, {:.2}]",
            start_sec,
            end_sec
        );
    }
    Ok(out)
}