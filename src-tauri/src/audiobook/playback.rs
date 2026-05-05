use anyhow::{anyhow, Context, Result};
use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use ffmpeg_next as ffmpeg;
use ringbuf::traits::{Consumer, Observer, Producer, Split};
use ringbuf::{HeapCons, HeapProd, HeapRb};
use std::sync::atomic::{AtomicBool, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::chapters::Chapter;

const RING_SECONDS: f32 = 8.0;
const PROGRESS_TICK_MS: u64 = 100;

/// 共享状态
struct Shared {
    popped_total: AtomicU64,
    pushed_total: AtomicU64,
    /// 当前 origin 对应的 popped_total 基准值
    /// played_since_origin = popped_total - origin_popped_baseline
    origin_popped_baseline: AtomicU64,
    decode_origin_sec: Mutex<f64>,
    seek_request: Mutex<Option<f64>>,
    discard_remaining: AtomicUsize,
    should_exit: AtomicBool,
    playing: AtomicBool,
    wake: (Mutex<bool>, Condvar),
    chapter_decode_done: AtomicBool,
    current_chapter_idx: AtomicUsize,
    current_chapter_end_sec: Mutex<f64>,
}

impl Shared {
    fn wake_decoder(&self) {
        let (lock, cvar) = &self.wake;
        let mut woken = lock.lock().unwrap();
        *woken = true;
        cvar.notify_one();
    }

    fn ring_occupied(&self) -> u64 {
        self.pushed_total
            .load(Ordering::Acquire)
            .saturating_sub(self.popped_total.load(Ordering::Acquire))
    }
}

pub struct PlaybackEngine {
    shared: Arc<Shared>,
    chapters: Arc<Vec<Chapter>>,
    output_sample_rate: u32,

    _stream: cpal::Stream,
    decode_handle: Option<JoinHandle<()>>,
    progress_handle: Option<JoinHandle<()>>,
}

impl PlaybackEngine {
    pub fn open(
        path: &str,
        chapters: Vec<Chapter>,
        chapter_index: usize,
        position_sec: f64,
        app: AppHandle,
    ) -> Result<Self> {
        ffmpeg::init().context("FFmpeg init")?;

        let chapter_idx = chapter_index.min(chapters.len().saturating_sub(1));
        let absolute_start_sec = chapters[chapter_idx].start_sec + position_sec;

        // ── cpal 输出 ─────────────────────────────────────────────────────────
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| anyhow!("No output device"))?;
        let supported = device
            .default_output_config()
            .context("default_output_config")?;
        let output_sample_rate: u32 = supported.sample_rate().into();
        let output_channels = supported.channels();

        log::info!(
            "PlaybackEngine: rate={} channels={}",
            output_sample_rate,
            output_channels
        );

        // ── shared ────────────────────────────────────────────────────────────
        let shared = Arc::new(Shared {
            popped_total: AtomicU64::new(0),
            pushed_total: AtomicU64::new(0),
            origin_popped_baseline: AtomicU64::new(0),
            decode_origin_sec: Mutex::new(absolute_start_sec),
            seek_request: Mutex::new(None),
            discard_remaining: AtomicUsize::new(0),
            should_exit: AtomicBool::new(false),
            playing: AtomicBool::new(false),
            wake: (Mutex::new(false), Condvar::new()),
            chapter_decode_done: AtomicBool::new(false),
            current_chapter_idx: AtomicUsize::new(chapter_idx),
            current_chapter_end_sec: Mutex::new(chapters[chapter_idx].end_sec),
        });

        // ── ring buffer ───────────────────────────────────────────────────────
        let cap = (output_sample_rate as f32 * RING_SECONDS) as usize;
        let rb = HeapRb::<f32>::new(cap);
        let (producer, consumer) = rb.split();

        // ── cpal stream ───────────────────────────────────────────────────────
        let stream = build_stream(
            &device,
            &supported.config(),
            output_channels,
            consumer,
            shared.clone(),
        )?;
        stream.pause().ok();

        // ── 解码线程 ──────────────────────────────────────────────────────────
        let decode_path = path.to_string();
        let decode_shared = shared.clone();
        let decode_chapters = chapters.clone();
        let decode_handle = thread::Builder::new()
            .name("audiobook-decode".into())
            .spawn(move || {
                if let Err(e) = decode_loop(
                    decode_path,
                    decode_chapters,
                    chapter_idx,
                    absolute_start_sec,
                    output_sample_rate,
                    producer,
                    decode_shared,
                ) {
                    log::error!("decode thread: {e:?}");
                }
            })
            .context("spawn decode thread")?;

        // ── 进度推送线程 ──────────────────────────────────────────────────────
        let chapters_arc = Arc::new(chapters);
        let progress_app = app.clone();
        let progress_chapters = chapters_arc.clone();
        let progress_shared = shared.clone();
        let progress_handle = thread::Builder::new()
            .name("audiobook-progress".into())
            .spawn(move || {
                progress_loop(
                    progress_app,
                    progress_chapters,
                    progress_shared,
                    output_sample_rate,
                );
            })
            .context("spawn progress thread")?;

        Ok(PlaybackEngine {
            shared,
            chapters: chapters_arc,
            output_sample_rate,
            _stream: stream,
            decode_handle: Some(decode_handle),
            progress_handle: Some(progress_handle),
        })
    }

    pub fn play(&self) -> Result<()> {
        // 如果之前是章节结束的"停"，当前 ring 已空、解码线程在 park
        // 主动让解码线程从章末位置继续？不需要 —— 章节结束是用户级行为，
        // 重新 play 应该有明确的目标位置（通常是 seek 或 go_to_chapter）。
        // 这里只 resume cpal stream。
        self._stream.play().map_err(|e| anyhow!("play: {e}"))?;
        self.shared.playing.store(true, Ordering::Release);
        self.shared.wake_decoder();
        Ok(())
    }

    pub fn pause(&self) -> Result<()> {
        self._stream.pause().map_err(|e| anyhow!("pause: {e}"))?;
        self.shared.playing.store(false, Ordering::Release);
        Ok(())
    }

    /// 跳转到指定章节内某秒。
    pub fn seek_in_chapter(&self, chapter_index: usize, position_sec: f64) -> Result<()> {
        let ch = self
            .chapters
            .get(chapter_index)
            .ok_or_else(|| anyhow!("invalid chapter index"))?;
        let abs = ch.start_sec + position_sec.max(0.0);
        let abs = abs.min(ch.end_sec.max(ch.start_sec));
        self.do_seek(abs, chapter_index, ch.end_sec)
    }

    fn do_seek(&self, abs_sec: f64, chapter_idx: usize, chapter_end: f64) -> Result<()> {
        // 设 discard：让 cpal 回调把当前 ring 残留全部"吃掉但不输出"
        let occupied = self.shared.ring_occupied() as usize;
        self.shared
            .discard_remaining
            .store(occupied, Ordering::Release);

        // 通知解码线程
        *self.shared.seek_request.lock().unwrap() = Some(abs_sec);
        self.shared
            .current_chapter_idx
            .store(chapter_idx, Ordering::Release);
        *self.shared.current_chapter_end_sec.lock().unwrap() = chapter_end;
        self.shared
            .chapter_decode_done
            .store(false, Ordering::Release);
        self.shared.wake_decoder();

        // cpal 不动！它要么在播（继续往下播 discard 后的内容），要么在暂停（用户点了暂停就保持暂停）
        Ok(())
    }
}

impl Drop for PlaybackEngine {
    fn drop(&mut self) {
        self.shared.should_exit.store(true, Ordering::Release);
        self.shared.playing.store(false, Ordering::Release);
        self.shared.wake_decoder();
        if let Some(h) = self.decode_handle.take() {
            let _ = h.join();
        }
        if let Some(h) = self.progress_handle.take() {
            let _ = h.join();
        }
    }
}

// ── cpal 回调 ─────────────────────────────────────────────────────────────────
fn build_stream(
    device: &cpal::Device,
    config: &cpal::StreamConfig,
    out_channels: u16,
    mut consumer: HeapCons<f32>,
    shared: Arc<Shared>,
) -> Result<cpal::Stream> {
    let channels = out_channels as usize;
    let stream = device
        .build_output_stream(
            config,
            move |out: &mut [f32], _: &cpal::OutputCallbackInfo| {
                let frames = out.len() / channels;

                // 1. 先吃掉 seek 留下的"discard"残留（不输出）
                let mut to_discard = shared.discard_remaining.load(Ordering::Acquire);
                let mut discarded = 0u64;
                while to_discard > 0 {
                    if consumer.try_pop().is_some() {
                        to_discard -= 1;
                        discarded += 1;
                    } else {
                        break;
                    }
                }
                if discarded > 0 {
                    shared.popped_total.fetch_add(discarded, Ordering::Relaxed);
                }
                shared
                    .discard_remaining
                    .store(to_discard, Ordering::Release);

                // 2. 正常填 out
                let mut filled = 0u64;
                for fi in 0..frames {
                    let s = consumer.try_pop().unwrap_or(0.0);
                    for ch in 0..channels {
                        out[fi * channels + ch] = s;
                    }
                    filled += 1;
                }
                shared.popped_total.fetch_add(filled, Ordering::Relaxed);
                shared.wake_decoder();
            },
            |err| log::error!("cpal stream: {err}"),
            None,
        )
        .context("build_output_stream")?;
    Ok(stream)
}

fn decode_loop(
    path: String,
    chapters: Vec<Chapter>,
    initial_chapter_idx: usize,
    initial_seek_sec: f64,
    output_rate: u32,
    mut producer: HeapProd<f32>,
    shared: Arc<Shared>,
) -> Result<()> {
    use ffmpeg::ffi;
    use std::os::raw::c_int;

    let mut ictx = ffmpeg::format::input(&path).with_context(|| format!("open: {path}"))?;
    let stream_info = {
        let s = ictx
            .streams()
            .best(ffmpeg::media::Type::Audio)
            .ok_or_else(|| anyhow!("no audio stream"))?;
        let idx = s.index();
        let tb = s.time_base();
        let tb_f = tb.numerator() as f64 / tb.denominator() as f64;
        let codec_ctx = ffmpeg::codec::Context::from_parameters(s.parameters())?;
        let decoder = codec_ctx.decoder().audio()?;
        let src_format = match decoder.format() {
            ffmpeg::format::Sample::None => {
                ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar)
            }
            f => f,
        };
        let src_rate = if decoder.rate() > 0 {
            decoder.rate()
        } else {
            48000
        };
        let (src_layout, _) = resolve_layout(&decoder, &ictx, idx);
        (idx, tb_f, decoder, src_format, src_rate, src_layout)
    };
    let (stream_index, stream_tb_f, mut decoder, src_format, src_rate, src_layout) = stream_info;

    let mut resampler = ffmpeg::software::resampling::Context::get(
        src_format,
        src_layout,
        src_rate,
        ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar),
        ffmpeg::channel_layout::ChannelLayout::MONO,
        output_rate,
    )?;

    // 初始 seek
    let mut current_chapter_idx = initial_chapter_idx;
    let mut current_chapter_end = chapters[initial_chapter_idx].end_sec;
    seek_to(
        &mut ictx,
        &mut decoder,
        stream_index,
        stream_tb_f,
        initial_seek_sec,
    )?;
    *shared.decode_origin_sec.lock().unwrap() = initial_seek_sec;
    shared.popped_total.store(0, Ordering::Release);
    shared.pushed_total.store(0, Ordering::Release);

    let mut decoded = ffmpeg::frame::Audio::empty();
    let mut resampled = ffmpeg::frame::Audio::empty();
    // 用解码 frame 的 pts 跟踪当前解码到哪
    let mut last_decode_pos_sec = initial_seek_sec;

    'main: loop {
        if shared.should_exit.load(Ordering::Acquire) {
            break;
        }

        // ── 1. 处理 seek 请求 ───────────────────────────────────
        let pending_seek = shared.seek_request.lock().unwrap().take();
        if let Some(target) = pending_seek {
            seek_to(&mut ictx, &mut decoder, stream_index, stream_tb_f, target)?;
            *shared.decode_origin_sec.lock().unwrap() = target;
            current_chapter_idx = shared.current_chapter_idx.load(Ordering::Acquire);
            current_chapter_end = *shared.current_chapter_end_sec.lock().unwrap();
            shared.chapter_decode_done.store(false, Ordering::Release);
            last_decode_pos_sec = target;
            let baseline = shared.pushed_total.load(Ordering::Acquire);
            shared
                .origin_popped_baseline
                .store(baseline, Ordering::Release);
            log::debug!("seek: target={:.2}s baseline={}", target, baseline);
            continue 'main;
        }

        // ── 2. 章节结束检测 ─────────────────────────────────────
        if last_decode_pos_sec >= current_chapter_end {
            shared.chapter_decode_done.store(true, Ordering::Release);
            park_decoder(&shared);
            continue 'main;
        }

        // ── 3. ring 满 → park ──────────────────────────────────
        let occupied = shared.ring_occupied() as usize;
        let cap = producer.capacity().get();
        if cap - occupied < output_rate as usize / 8 {
            park_decoder(&shared);
            continue 'main;
        }

        // ── 4. 解一帧 ───────────────────────────────────────────
        match decoder.receive_frame(&mut decoded) {
            Ok(_) => {
                if let Some(pts) = decoded.pts() {
                    last_decode_pos_sec = pts as f64 * stream_tb_f;
                }
                resampler.run(&decoded, &mut resampled)?;
                push_samples(&resampled, &mut producer, &shared)?;
            }
            Err(ffmpeg::Error::Other {
                errno: ffmpeg::error::EAGAIN,
            }) => {
                if !feed_one_packet(&mut ictx, &mut decoder, stream_index)? {
                    decoder.send_eof().ok();
                    while decoder.receive_frame(&mut decoded).is_ok() {
                        resampler.run(&decoded, &mut resampled)?;
                        push_samples(&resampled, &mut producer, &shared)?;
                    }
                    shared.chapter_decode_done.store(true, Ordering::Release);
                    park_decoder(&shared);
                }
            }
            Err(ffmpeg::Error::Eof) => {
                shared.chapter_decode_done.store(true, Ordering::Release);
                park_decoder(&shared);
            }
            Err(e) => return Err(anyhow!(e)),
        }
    }
    log::info!("decode thread exited");
    Ok(())
}

/// 喂一个 packet，返回 false 表示 EOF
fn feed_one_packet(
    ictx: &mut ffmpeg::format::context::Input,
    decoder: &mut ffmpeg::decoder::Audio,
    stream_index: usize,
) -> Result<bool> {
    for (s, p) in ictx.packets() {
        if s.index() == stream_index {
            decoder.send_packet(&p).ok();
            return Ok(true);
        }
    }
    Ok(false)
}

fn seek_to(
    ictx: &mut ffmpeg::format::context::Input,
    decoder: &mut ffmpeg::decoder::Audio,
    stream_index: usize,
    stream_tb_f: f64,
    sec: f64,
) -> Result<()> {
    use ffmpeg::ffi;
    use std::os::raw::c_int;
    let ts = (sec / stream_tb_f) as i64;
    unsafe {
        let ret = ffi::av_seek_frame(
            ictx.as_mut_ptr(),
            stream_index as c_int,
            ts,
            ffi::AVSEEK_FLAG_BACKWARD as c_int,
        );
        if ret < 0 {
            return Err(anyhow!("av_seek_frame: {ret}"));
        }
        ffi::avcodec_flush_buffers(decoder.as_mut_ptr());
    }
    Ok(())
}

fn park_decoder(shared: &Arc<Shared>) {
    let (lock, cvar) = &shared.wake;
    let mut woken = lock.lock().unwrap();
    while !*woken && !shared.should_exit.load(Ordering::Acquire) {
        let r = cvar
            .wait_timeout(woken, Duration::from_millis(200))
            .unwrap();
        woken = r.0;
        if r.1.timed_out() {
            break;
        }
    }
    *woken = false;
}

fn push_samples(
    frame: &ffmpeg::frame::Audio,
    producer: &mut HeapProd<f32>,
    shared: &Arc<Shared>,
) -> Result<()> {
    let n = frame.samples();
    if n == 0 {
        return Ok(());
    }
    let data = frame.data(0);
    let slice = unsafe { std::slice::from_raw_parts(data.as_ptr() as *const f32, n) };

    let mut written = 0;
    while written < slice.len() {
        if shared.should_exit.load(Ordering::Acquire) {
            return Ok(());
        }
        // seek 来了就放弃当前 frame
        if shared.seek_request.lock().unwrap().is_some() {
            return Ok(());
        }
        let pushed = producer.push_slice(&slice[written..]);
        if pushed > 0 {
            written += pushed;
            shared
                .pushed_total
                .fetch_add(pushed as u64, Ordering::Relaxed);
        } else {
            // ring 满 → park
            park_decoder(shared);
        }
    }
    Ok(())
}

fn resolve_layout(
    decoder: &ffmpeg::decoder::Audio,
    input: &ffmpeg::format::context::Input,
    stream_index: usize,
) -> (ffmpeg::channel_layout::ChannelLayout, u32) {
    use ffmpeg::channel_layout::ChannelLayout;
    let layout = decoder.channel_layout();
    if layout.bits() != 0 {
        return (layout, layout.channels() as u32);
    }
    let ch: u32 = unsafe {
        let stream = input.stream(stream_index).unwrap();
        let par = stream.parameters().as_ptr();
        let nb = (*par).ch_layout.nb_channels;
        if nb > 0 {
            nb as u32
        } else {
            0
        }
    };
    let layout = match ch {
        1 => ChannelLayout::MONO,
        2 => ChannelLayout::STEREO,
        3 => ChannelLayout::SURROUND,
        4 => ChannelLayout::_4POINT0,
        5 => ChannelLayout::_5POINT0,
        6 => ChannelLayout::_5POINT1,
        7 => ChannelLayout::_6POINT1,
        8 => ChannelLayout::_7POINT1,
        _ => ChannelLayout::STEREO,
    };
    (layout, if ch > 0 { ch } else { 2 })
}

// ── 进度推送 ──────────────────────────────────────────────────────────────────
fn progress_loop(
    app: AppHandle,
    chapters: Arc<Vec<Chapter>>,
    shared: Arc<Shared>,
    output_rate: u32,
) {
    let mut last_emit_chapter_ended: Option<usize> = None;

    while !shared.should_exit.load(Ordering::Acquire) {
        thread::sleep(Duration::from_millis(PROGRESS_TICK_MS));

        // 当前播放绝对秒 = origin + (popped - origin_popped_baseline) / rate
        let popped = shared.popped_total.load(Ordering::Acquire);
        let baseline = shared.origin_popped_baseline.load(Ordering::Acquire);
        let played = popped.saturating_sub(baseline);
        let abs_sec =
            *shared.decode_origin_sec.lock().unwrap() + played as f64 / output_rate as f64;

        let (chapter_idx, chapter_pos) = locate_chapter(&chapters, abs_sec);

        // ── 章节自然结束检测 ──────────────────────────────────────────────────
        // 条件：解码已到章末 + ring 已空 + 当前在播放 + 自上次 seek 以来确实播过新数据
        // 最后一项很关键：seek 刚发起时 ring 可能瞬间为空，会误判
        let decode_done = shared.chapter_decode_done.load(Ordering::Acquire);
        let ring_empty = shared.ring_occupied() == 0;
        let is_playing = shared.playing.load(Ordering::Acquire);
        let has_played_since_seek = popped > baseline;

        if decode_done && ring_empty && is_playing && has_played_since_seek {
            let cur = shared.current_chapter_idx.load(Ordering::Acquire);
            if last_emit_chapter_ended != Some(cur) {
                last_emit_chapter_ended = Some(cur);
                // 注意：这里不 store playing = false
                // 由前端收到事件后调用 playback_pause 命令统一处理 cpal stream 的 pause
                let _ = app.emit(
                    "playback-chapter-ended",
                    serde_json::json!({ "chapterIndex": cur }),
                );
                log::info!("chapter {} ended", cur);
            }
        } else if !decode_done {
            // 解码恢复了（seek 到新位置）→ 允许重新触发 chapter-ended
            last_emit_chapter_ended = None;
        }

        let _ = app.emit(
            "playback-progress",
            serde_json::json!({
                "chapterIndex": chapter_idx,
                "positionSec": chapter_pos,
                "playing": is_playing,
            }),
        );
    }
    log::info!("progress thread exited");
}

fn locate_chapter(chapters: &[Chapter], abs_sec: f64) -> (usize, f64) {
    for (i, ch) in chapters.iter().enumerate() {
        if abs_sec < ch.end_sec {
            return (i, (abs_sec - ch.start_sec).max(0.0));
        }
    }
    let last = chapters.len().saturating_sub(1);
    (last, (abs_sec - chapters[last].start_sec).max(0.0))
}
