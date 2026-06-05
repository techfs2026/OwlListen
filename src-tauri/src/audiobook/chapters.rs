use anyhow::{Context, Result};
use ffmpeg_next as ffmpeg;
use serde::{Deserialize, Serialize};

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

    let input = ffmpeg::format::input(&path).with_context(|| format!("Cannot open: {path}"))?;

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
                let end_sec = ch.end() as f64 * tb_f;
                let ch_title = ch
                    .metadata()
                    .get("title")
                    .unwrap_or(&format!("第 {} 章", i + 1))
                    .to_string();
                Chapter {
                    index: i,
                    title: ch_title,
                    start_sec,
                    end_sec,
                }
            })
            .collect()
    };

    Ok(AudiobookMeta {
        title,
        author,
        duration_sec,
        chapters,
    })
}
