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
    /// do_seek 写入目标秒数，cpal flush 时取出并原子性地切换 decode_origin_sec
    pending_origin_sec: Mutex<Option<f64>>,
    seek_request: Mutex<Option<f64>>,
    should_exit: AtomicBool,
    /// do_seek 置 true → cpal 回调执行 flush 动作
    flushing_ring: AtomicBool,
    /// cpal flush 完成后置 true → push_samples 第一次成功写入后清 false
    /// flushing=true 期间 cpal 正常 pop 但不推进 popped_total（屏蔽进度）
    flushing: AtomicBool,
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
            pending_origin_sec: Mutex::new(None),
            seek_request: Mutex::new(None),
            flushing_ring: AtomicBool::new(false),
            flushing: AtomicBool::new(false),
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
        let s = &self.shared;

        if s.playing.load(Ordering::Acquire) {
            // ── 播放中：交给 cpal 回调在下一个 callback 里执行 flush ──────────
            // cpal 回调会：清空 ring → 更新 popped_total → 锁定 baseline →
            //              取出 pending_origin_sec 写入 decode_origin_sec → 置 flushing=true
            *s.pending_origin_sec.lock().unwrap() = Some(abs_sec);
            s.flushing_ring.store(true, Ordering::Release);
        } else {
            // ── 暂停中：cpal 回调不跑，直接在主线程完成 flush ────────────────
            // 此时解码线程在 park，ring 不会有新数据写入，直接操作是安全的。
            // 注意：ring 的 consumer 在 cpal 回调闭包里，这里无法直接清空，
            // 改为把 pushed_total 拉平到 popped_total，让 ring_occupied() == 0，
            // 并把 flushing_ring 置 true，等 play() 触发第一个 cpal callback 时再真正清空。
            // 但 origin/baseline 必须现在就更新，否则 progress_loop 在 paused 期间会显示旧位置。
            *s.decode_origin_sec.lock().unwrap() = abs_sec;
            let cur_popped = s.popped_total.load(Ordering::Acquire);
            s.origin_popped_baseline.store(cur_popped, Ordering::Release);
            // 让 ring_occupied() 看起来为 0（解码线程不会在 park 时 push）
            s.pushed_total.store(cur_popped, Ordering::Release);
            // 仍然设 flushing_ring，play() 后第一个 callback 会真正清空 ring 里残留的旧数据
            s.flushing_ring.store(true, Ordering::Release);
            s.flushing.store(true, Ordering::Release);
        }

        // 通知解码线程
        *s.seek_request.lock().unwrap() = Some(abs_sec);
        s.current_chapter_idx.store(chapter_idx, Ordering::Release);
        *s.current_chapter_end_sec.lock().unwrap() = chapter_end;
        s.chapter_decode_done.store(false, Ordering::Release);
        s.wake_decoder();

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

                // ── 1. seek flush ────────────────────────────────────────────
                // 清空 ring，并在同一个 callback 内原子性地切换 origin 和 baseline，
                // 确保 progress_loop 读到的两个值永远是同一个 seek 的配对。
                if shared.flushing_ring.swap(false, Ordering::AcqRel) {
                    let mut discarded = 0u64;
                    while consumer.try_pop().is_some() {
                        discarded += 1;
                    }
                    // discarded 按实际从 ring 弹出的 f32 数计（与 push_samples 单位一致）
                    shared.popped_total.fetch_add(discarded, Ordering::Relaxed);

                    // baseline 锁定：ring 清空后此刻的 popped_total 就是新的零点
                    let new_baseline = shared.popped_total.load(Ordering::Relaxed);
                    shared
                        .origin_popped_baseline
                        .store(new_baseline, Ordering::Relaxed);

                    // 同步切换 decode_origin_sec（由 do_seek 通过 pending_origin_sec 传来）
                    if let Some(origin) = shared.pending_origin_sec.lock().unwrap().take() {
                        *shared.decode_origin_sec.lock().unwrap() = origin;
                    }

                    // 通知 pop 段：ring 已空，等新数据进来再开始推进进度
                    shared.flushing.store(true, Ordering::Release);

                    log::debug!(
                        "cpal flush done: discarded={} new_baseline={}",
                        discarded,
                        new_baseline
                    );
                }

                // ── 2. 正常填 out ────────────────────────────────────────────
                // flushing=true 期间输出静音（ring 为空 try_pop 返回 None → 0.0），
                // 但不推进 popped_total，避免进度在新数据到来前乱跳。
                let is_flushing = shared.flushing.load(Ordering::Acquire);
                let mut filled = 0u64;
                for fi in 0..frames {
                    // ring 里存的是单声道 f32，每次 pop 一个，复制到所有输出声道
                    let s = consumer.try_pop().unwrap_or(0.0);
                    for ch in 0..channels {
                        out[fi * channels + ch] = s;
                    }
                    // 只计实际从 ring 弹出的逻辑采样数（不乘 channels）
                    if !is_flushing {
                        filled += 1;
                    }
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
    // 初始化时直接写（此时 cpal stream 还未 play，无竞态）
    *shared.decode_origin_sec.lock().unwrap() = initial_seek_sec;
    shared.popped_total.store(0, Ordering::Release);
    shared.pushed_total.store(0, Ordering::Release);
    shared.origin_popped_baseline.store(0, Ordering::Release);

    let mut decoded = ffmpeg::frame::Audio::empty();
    let mut resampled = ffmpeg::frame::Audio::empty();
    let mut last_decode_pos_sec = initial_seek_sec;
    let mut skip_until_sec: Option<f64> = None;

    'main: loop {
        if shared.should_exit.load(Ordering::Acquire) {
            break;
        }

        // ── 1. 处理 seek 请求 ────────────────────────────────────────────────
        let pending_seek = shared.seek_request.lock().unwrap().take();
        if let Some(target) = pending_seek {
            seek_to(&mut ictx, &mut decoder, stream_index, stream_tb_f, target)?;

            // AAC/M4B：seek 后 resampler 内部仍缓存着旧数据，必须重建。
            // 否则 resampler 会在新帧之前吐出一批旧数据混入 ring，造成听到旧章节内容。
            resampler = ffmpeg::software::resampling::Context::get(
                src_format,
                src_layout,
                src_rate,
                ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar),
                ffmpeg::channel_layout::ChannelLayout::MONO,
                output_rate,
            )?;

            // decode_origin_sec / baseline 由 cpal flush 回调（或 do_seek 暂停分支）负责更新
            current_chapter_idx = shared.current_chapter_idx.load(Ordering::Acquire);
            current_chapter_end = *shared.current_chapter_end_sec.lock().unwrap();
            shared.chapter_decode_done.store(false, Ordering::Release);
            last_decode_pos_sec = target;
            // AAC GOP 对齐：seek 会落到目标前的关键帧，skip_until_sec 丢弃目标前的帧
            skip_until_sec = Some(target);
            log::debug!("decode seek: target={:.2}s", target);
            continue 'main;
        }

        // ── 2. 章节结束检测 ──────────────────────────────────────────────────
        if last_decode_pos_sec >= current_chapter_end {
            shared.chapter_decode_done.store(true, Ordering::Release);
            park_decoder(&shared);
            continue 'main;
        }

        // ── 3. ring 满 → park ────────────────────────────────────────────────
        let occupied = shared.ring_occupied() as usize;
        let cap = producer.capacity().get();
        if cap - occupied < output_rate as usize / 8 {
            park_decoder(&shared);
            continue 'main;
        }

        // ── 4. 解一帧 ────────────────────────────────────────────────────────
        match decoder.receive_frame(&mut decoded) {
            Ok(_) => {
                let mut frame_sec = last_decode_pos_sec;
                if let Some(pts) = decoded.pts() {
                    frame_sec = pts as f64 * stream_tb_f;
                    last_decode_pos_sec = frame_sec;
                }

                if let Some(target_sec) = skip_until_sec {
                    // AAC 的 pts 在 seek 后前几帧可能是 None 或不准确。
                    // 策略：pts 已知时，pts < target 的帧全丢；
                    //        pts 为 None 时，用 last_decode_pos_sec 兜底继续丢。
                    // 一旦 pts >= target，认为已到达正确位置，清除标记并放行。
                    let effective_sec = decoded.pts()
                        .map(|p| p as f64 * stream_tb_f)
                        .unwrap_or(last_decode_pos_sec);
                    if effective_sec < target_sec {
                        continue 'main;
                    }
                    skip_until_sec = None;
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
        // seek 来了就放弃当前 frame，回到主循环处理新的 seek_request
        if shared.seek_request.lock().unwrap().is_some() {
            return Ok(());
        }
        let pushed = producer.push_slice(&slice[written..]);
        if pushed > 0 {
            // 第一批新数据成功入 ring → 清掉 flushing，cpal 可以重新推进进度
            if shared.flushing.swap(false, Ordering::AcqRel) {
                log::debug!("push_samples: flushing cleared, new audio flowing");
            }
            written += pushed;
            // pushed 是实际写入 ring 的 f32 数，与 cpal pop 端计数单位一致
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
        if nb > 0 { nb as u32 } else { 0 }
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

        // 当前播放绝对秒 = origin + (popped - baseline) / rate
        // origin 和 baseline 在同一个 cpal callback 里原子性切换，读取时配对一致
        let popped = shared.popped_total.load(Ordering::Acquire);
        let baseline = shared.origin_popped_baseline.load(Ordering::Acquire);
        let played = popped.saturating_sub(baseline);
        let abs_sec =
            *shared.decode_origin_sec.lock().unwrap() + played as f64 / output_rate as f64;

        let (chapter_idx, chapter_pos) = locate_chapter(&chapters, abs_sec);

        // ── 章节自然结束检测 ──────────────────────────────────────────────────
        let decode_done = shared.chapter_decode_done.load(Ordering::Acquire);
        let ring_empty = shared.ring_occupied() == 0;
        let is_playing = shared.playing.load(Ordering::Acquire);
        let has_played_since_seek = popped > baseline;

        if decode_done && ring_empty && is_playing && has_played_since_seek {
            let cur = shared.current_chapter_idx.load(Ordering::Acquire);
            if last_emit_chapter_ended != Some(cur) {
                last_emit_chapter_ended = Some(cur);
                let _ = app.emit(
                    "playback-chapter-ended",
                    serde_json::json!({ "chapterIndex": cur }),
                );
                log::info!("chapter {} ended", cur);
            }
        } else if !decode_done {
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