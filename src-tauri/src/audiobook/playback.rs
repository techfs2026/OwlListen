/// playback.rs — 跨平台 cpal 后端 + FFmpeg atempo 变速不变调
///
/// # 架构
///
/// ```text
/// Tauri命令线程
///     │  seek_in_chapter() → write_gen++
///     │  set_speed()       → speed_bits 更新 + speed_gen++
///     │  play/pause        → cpal play/pause
///     ↓
/// decode线程（FFmpeg）
///     │  检测 seek_target → av_seek_frame → 重建 atempo
///     │  检测 speed_gen 变化 → 重建 atempo（rate 改变需要新 filter graph）
///     │  解码 → atempo 变速不变调 + 降混为 mono（采样率保持源采样率）
///     │  push 到 SpscRing
///     ↓
/// SpscRing（自己实现的 lock-free SPSC ring buffer）
///     ↓
/// cpal output stream callback（输出流配在源采样率上）
///     │  检测 read_gen != write_gen → drain ring → 切换 origin → 淡入
///     │  正常 pop → 应用淡入包络 → 写入 interleaved 输出 buffer
///     ↓
/// 硬件输出（macOS CoreAudio / Windows WASAPI / Linux ALSA）
///     └ 源采样率→硬件采样率的转换交给操作系统音频层，应用内不做重采样
/// ```
///
/// # 不做应用层重采样
///
/// 有声书按自身采样率播放：cpal 输出流直接配在源采样率（如 22.05kHz），
/// 设备硬件采样率（如 48kHz）的差异由操作系统音频层负责转换。
/// 这样既省去一条容易出错的重采样管线，也保证音高/语速完全正确。
///
/// # seek 不爆音
///
/// 1. do_seek 写好 pending_origin_*，最后递增 write_gen（Release）
/// 2. cpal callback 每次开头检查 read_gen vs write_gen：
///    - 不同 → drain ring → 切换 origin → read_gen = write_gen → fade_mult = 0
///    - 相同 → 正常消费
/// 3. drain + 切换在同一次 callback 内原子完成
///
/// # 变速不变调
///
/// 用 FFmpeg 的 atempo filter，在 decode 线程解码之后。
/// atempo 同时通过 aformat 把声道降混为 mono（采样率保持不变）。
/// rate 改变时（用户切换速率档位），需要重建 atempo filter graph 并 flush。
/// atempo 单段范围 0.5~100，目前需求 [0.5 ~ 1.75] 完全覆盖。
///
/// # 进度计算
///
/// 变速影响进度推进速率：source_seconds = output_seconds * rate
/// origin_baseline 记录 seek 时的 popped_total，进度 = origin_sec + (popped - baseline) / rate / output_rate
/// 注意：speed 改变时 origin 也要"快照"当前位置，否则进度会跳变。
/// 实现：set_speed 触发一次 do_seek 到当前位置，等价于"在当前进度切换速率"。
use anyhow::{anyhow, Context, Result};
use audioplayer::{AtempoFilter, FillInfo, OutputSink, SampleSource};
use cpal::traits::{DeviceTrait, HostTrait};
use ffmpeg_next as ffmpeg;
use std::sync::atomic::{AtomicBool, AtomicU32, AtomicU64, AtomicUsize, Ordering};
use std::sync::{Arc, Condvar, Mutex};
use std::thread::{self, JoinHandle};
use std::time::Duration;
use tauri::{AppHandle, Emitter};

use super::chapters::Chapter;

// ── 常量 ──────────────────────────────────────────────────────────────────────

const RING_SECONDS: f32 = 8.0;
const PROGRESS_TICK_MS: u64 = 100;

// ── SpscRing ─────────────────────────────────────────────────────────────────

/// 单生产者单消费者无锁环形缓冲，f32 元素。
/// head/tail 用单调递增 u64，clear 后立即对另一端可见，没有缓存视图问题。
struct SpscRing {
    buf: Box<[std::cell::UnsafeCell<f32>]>,
    capacity: usize,
    head: AtomicU64,
    tail: AtomicU64,
}

unsafe impl Sync for SpscRing {}
unsafe impl Send for SpscRing {}

impl SpscRing {
    fn new(capacity: usize) -> Self {
        let mut v = Vec::with_capacity(capacity);
        for _ in 0..capacity {
            v.push(std::cell::UnsafeCell::new(0.0));
        }
        Self {
            buf: v.into_boxed_slice(),
            capacity,
            head: AtomicU64::new(0),
            tail: AtomicU64::new(0),
        }
    }

    fn occupied(&self) -> usize {
        let h = self.head.load(Ordering::Acquire);
        let t = self.tail.load(Ordering::Acquire);
        h.saturating_sub(t) as usize
    }

    fn vacant(&self) -> usize {
        self.capacity - self.occupied()
    }

    fn push_slice(&self, data: &[f32]) -> usize {
        let h = self.head.load(Ordering::Relaxed);
        let t = self.tail.load(Ordering::Acquire);
        let vacant = self.capacity - (h - t) as usize;
        let n = data.len().min(vacant);
        if n == 0 {
            return 0;
        }
        for i in 0..n {
            let idx = ((h + i as u64) % self.capacity as u64) as usize;
            unsafe {
                *self.buf[idx].get() = data[i];
            }
        }
        self.head.store(h + n as u64, Ordering::Release);
        n
    }

    fn try_pop(&self) -> Option<f32> {
        let t = self.tail.load(Ordering::Relaxed);
        let h = self.head.load(Ordering::Acquire);
        if t >= h {
            return None;
        }
        let idx = (t % self.capacity as u64) as usize;
        let val = unsafe { *self.buf[idx].get() };
        self.tail.store(t + 1, Ordering::Release);
        Some(val)
    }

    fn clear(&self) {
        let h = self.head.load(Ordering::Acquire);
        self.tail.store(h, Ordering::Release);
    }
}

// ── 共享状态 ──────────────────────────────────────────────────────────────────

struct Shared {
    ring: SpscRing,

    // 进度计数
    popped_total: AtomicU64,
    pushed_total: AtomicU64,
    origin_baseline: AtomicU64,
    origin_sec: Mutex<f64>,

    // seek / generation
    write_gen: AtomicU32,
    read_gen: AtomicU32,
    seek_target: Mutex<Option<f64>>,
    pending_origin_sec: Mutex<Option<f64>>,
    pending_origin_baseline: AtomicU64,

    // 控制
    should_exit: AtomicBool,
    playing: AtomicBool,

    // decode 唤醒
    wake: (Mutex<bool>, Condvar),

    // 章节
    chapter_decode_done: AtomicBool,
    current_chapter_idx: AtomicUsize,
    current_chapter_end_sec: Mutex<f64>,

    // 变速：speed_bits 是当前速率（f32 bits），speed_gen 改变时 decode 线程重建 atempo
    speed_bits: AtomicU32,
    speed_gen: AtomicU32,
    decoder_speed_gen: AtomicU32,
}

impl Shared {
    fn wake_decoder(&self) {
        let (lock, cvar) = &self.wake;
        let mut w = lock.lock().unwrap();
        *w = true;
        cvar.notify_one();
    }

    fn speed(&self) -> f32 {
        f32::from_bits(self.speed_bits.load(Ordering::Relaxed))
    }
}

/// 把流式 ring 适配成 OutputSink 的样本来源。
/// 逻辑等价于原 build_stream 回调里 Shared 相关的那部分；
/// 淡入/underrun/声道复制现在归 OutputSink 管。
impl SampleSource for Shared {
    fn fill(&self, out: &mut [f32]) -> FillInfo {
        // gen 切换检测：seek/换源时清环、切 origin baseline，并要求 OutputSink 重置淡入。
        let mut discontinuity = false;
        let write_gen = self.write_gen.load(Ordering::Acquire);
        if self.read_gen.load(Ordering::Relaxed) != write_gen {
            self.ring.clear();

            let new_baseline = self.pending_origin_baseline.load(Ordering::Acquire);
            self.origin_baseline.store(new_baseline, Ordering::Release);

            if let Ok(mut guard) = self.pending_origin_sec.try_lock() {
                if let Some(sec) = guard.take() {
                    if let Ok(mut orig) = self.origin_sec.try_lock() {
                        *orig = sec;
                    }
                }
            }

            self.read_gen.store(write_gen, Ordering::Release);
            discontinuity = true;
            log::debug!("cpal: gen→{write_gen}");
        }

        // 从 ring 连续 pop：取到 None（underrun）即停，其余由 OutputSink 衰减静音。
        let mut produced = 0usize;
        for slot in out.iter_mut() {
            match self.ring.try_pop() {
                Some(v) => {
                    *slot = v;
                    produced += 1;
                }
                None => break,
            }
        }

        let prev_total = self
            .popped_total
            .fetch_add(produced as u64, Ordering::Relaxed);
        self.wake_decoder();

        FillInfo {
            produced,
            discontinuity,
            // 播放时钟坐标用累计消费数（有声书进度走 origin 换算、不读时钟，仅满足契约）
            run_start_sample: prev_total,
            run_offset: 0,
        }
    }
}

// ── PlaybackEngine ────────────────────────────────────────────────────────────

pub struct PlaybackEngine {
    shared: Arc<Shared>,
    chapters: Arc<Vec<Chapter>>,
    output_sample_rate: u32,
    _sink: OutputSink,
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
        let abs_start = chapters[chapter_idx].start_sec + position_sec.max(0.0);

        // 有声书按自身采样率播放，不做应用层重采样：
        // cpal 输出流直接配置成源采样率，硬件采样率的差异交给操作系统音频层
        // （macOS CoreAudio / Windows WASAPI 等）自己转换。
        let src_rate = probe_audio_rate(path)?;

        // ── cpal 输出设备 ─────────────────────────────────────────────────────
        let host = cpal::default_host();
        let device = host
            .default_output_device()
            .ok_or_else(|| anyhow!("no output device"))?;
        let supported = device
            .default_output_config()
            .context("default_output_config")?;
        let output_channels = supported.channels();
        let output_sample_rate: u32 = src_rate;

        // 用设备的声道数 + 源采样率组成输出配置（cpal 0.17 里 SampleRate 即 u32）
        let stream_config = cpal::StreamConfig {
            channels: output_channels,
            sample_rate: src_rate,
            buffer_size: cpal::BufferSize::Default,
        };

        log::info!(
            "PlaybackEngine: src_rate={src_rate} channels={output_channels} (device default rate was {})",
            supported.sample_rate(),
        );

        // ── Shared ────────────────────────────────────────────────────────────
        let cap = (output_sample_rate as f32 * RING_SECONDS) as usize;
        let shared = Arc::new(Shared {
            ring: SpscRing::new(cap),
            popped_total: AtomicU64::new(0),
            pushed_total: AtomicU64::new(0),
            origin_baseline: AtomicU64::new(0),
            origin_sec: Mutex::new(abs_start),
            write_gen: AtomicU32::new(0),
            read_gen: AtomicU32::new(0),
            seek_target: Mutex::new(None),
            pending_origin_sec: Mutex::new(None),
            pending_origin_baseline: AtomicU64::new(0),
            should_exit: AtomicBool::new(false),
            playing: AtomicBool::new(false),
            wake: (Mutex::new(false), Condvar::new()),
            chapter_decode_done: AtomicBool::new(false),
            current_chapter_idx: AtomicUsize::new(chapter_idx),
            current_chapter_end_sec: Mutex::new(chapters[chapter_idx].end_sec),
            speed_bits: AtomicU32::new(1.0f32.to_bits()),
            speed_gen: AtomicU32::new(0),
            decoder_speed_gen: AtomicU32::new(0),
        });

        // ── cpal 输出层 ────────────────────────────────────────────────────────
        // OutputSink 管设备输出流 + 淡入 + underrun + 声道复制；
        // 样本由 Shared（ring 流式）通过 SampleSource 提供。
        let sink = OutputSink::new(&device, &stream_config, shared.clone())?;
        sink.pause().ok();

        // ── decode 线程 ───────────────────────────────────────────────────────
        let chapters_arc = Arc::new(chapters);
        let decode_shared = shared.clone();
        let decode_chapters = chapters_arc.clone();
        let decode_path = path.to_string();
        let app_decode = app.clone();
        let decode_handle = thread::Builder::new()
            .name("audiobook-decode".into())
            .spawn(move || {
                log::info!("decode thread starting");
                if let Err(e) = decode_loop(
                    decode_path,
                    decode_chapters,
                    chapter_idx,
                    abs_start,
                    decode_shared,
                ) {
                    log::error!("decode thread error: {e:?}");
                    // 解码线程异常退出会让播放静默冻住，通知前端给用户提示
                    let _ = app_decode.emit(
                        "playback-error",
                        serde_json::json!({ "message": format!("{e}") }),
                    );
                }
                log::info!("decode thread function returned");
            })
            .context("spawn decode thread")?;

        // ── 进度推送线程 ──────────────────────────────────────────────────────
        let progress_shared = shared.clone();
        let progress_chapters = chapters_arc.clone();
        let progress_handle = thread::Builder::new()
            .name("audiobook-progress".into())
            .spawn(move || {
                progress_loop(app, progress_chapters, progress_shared, output_sample_rate);
            })
            .context("spawn progress thread")?;

        Ok(PlaybackEngine {
            shared,
            chapters: chapters_arc,
            output_sample_rate,
            _sink: sink,
            decode_handle: Some(decode_handle),
            progress_handle: Some(progress_handle),
        })
    }

    pub fn play(&self) -> Result<()> {
        log::info!("PlaybackEngine::play()");
        self._sink.play()?;
        self.shared.playing.store(true, Ordering::Release);
        self.shared.wake_decoder();
        Ok(())
    }

    pub fn pause(&self) -> Result<()> {
        log::info!("PlaybackEngine::pause()");
        self._sink.pause()?;
        self.shared.playing.store(false, Ordering::Release);
        Ok(())
    }

    /// 设置播放速率（0.5 ~ 4.0），通过 FFmpeg atempo filter 实现，音调不变。
    /// 内部触发一次"原地 seek"，让 origin 在当前位置快照后切换速率，
    /// 这样进度推进的速率换算正确，UI 看到的 currentTime 不会跳变。
    pub fn set_speed(&self, speed: f32) -> Result<()> {
        let clamped = speed.clamp(0.5, 4.0);
        let cur = f32::from_bits(self.shared.speed_bits.load(Ordering::Relaxed));
        if (cur - clamped).abs() < 1e-4 {
            return Ok(()); // 没变化，跳过
        }

        // 计算当前的"绝对秒"位置
        let popped = self.shared.popped_total.load(Ordering::Acquire);
        let baseline = self.shared.origin_baseline.load(Ordering::Acquire);
        let played_output_samples = popped.saturating_sub(baseline);
        let played_source_sec =
            played_output_samples as f64 / self.output_sample_rate as f64 * cur as f64;
        let cur_origin = *self.shared.origin_sec.lock().unwrap();
        let cur_abs_sec = cur_origin + played_source_sec;

        // 找到当前章节信息
        let (chapter_idx, _) = locate_chapter(&self.chapters, cur_abs_sec);
        let chapter_end = self.chapters[chapter_idx].end_sec;

        // 写入新速率
        self.shared
            .speed_bits
            .store(clamped.to_bits(), Ordering::Relaxed);
        self.shared.speed_gen.fetch_add(1, Ordering::Release);

        // 触发 do_seek：清空 ring，origin 切换到当前位置
        // 这样 atempo 重建后从当前位置开始解码，进度推进按新速率换算
        self.do_seek(cur_abs_sec, chapter_idx, chapter_end)?;

        log::info!("set_speed: {cur} → {clamped} at {cur_abs_sec:.2}s");
        Ok(())
    }

    pub fn seek_in_chapter(&self, chapter_index: usize, position_sec: f64) -> Result<()> {
        let ch = self
            .chapters
            .get(chapter_index)
            .ok_or_else(|| anyhow!("invalid chapter index {chapter_index}"))?;
        let abs = (ch.start_sec + position_sec.max(0.0)).min(ch.end_sec.max(ch.start_sec));
        self.do_seek(abs, chapter_index, ch.end_sec)
    }

    fn do_seek(&self, abs_sec: f64, chapter_idx: usize, chapter_end: f64) -> Result<()> {
        let s = &self.shared;

        *s.seek_target.lock().unwrap() = Some(abs_sec);

        let cur_popped = s.popped_total.load(Ordering::Acquire);
        s.pending_origin_baseline
            .store(cur_popped, Ordering::Relaxed);
        *s.pending_origin_sec.lock().unwrap() = Some(abs_sec);

        s.write_gen.fetch_add(1, Ordering::Release);

        s.current_chapter_idx.store(chapter_idx, Ordering::Release);
        *s.current_chapter_end_sec.lock().unwrap() = chapter_end;
        s.chapter_decode_done.store(false, Ordering::Release);

        s.wake_decoder();

        log::debug!("do_seek: {abs_sec:.2}s chapter={chapter_idx}");
        Ok(())
    }
}

impl Drop for PlaybackEngine {
    fn drop(&mut self) {
        self.shared.should_exit.store(true, Ordering::Release);
        self.shared.playing.store(false, Ordering::Release);
        self.shared.wake_decoder();
        let _ = self._sink.pause();
        if let Some(h) = self.decode_handle.take() {
            let _ = h.join();
        }
        if let Some(h) = self.progress_handle.take() {
            let _ = h.join();
        }
        log::info!("PlaybackEngine dropped");
    }
}

// ── 探测采样率 ────────────────────────────────────────────────────────────────
// cpal 输出层已抽到 audioplayer::OutputSink；这里只保留有声书特有的采样率探测。

/// 读取音频流的采样率（用于把 cpal 输出流配置成源采样率，省去应用层重采样）。
fn probe_audio_rate(path: &str) -> Result<u32> {
    let ictx = ffmpeg::format::input(&path).with_context(|| format!("probe open: {path}"))?;
    let stream = ictx
        .streams()
        .best(ffmpeg::media::Type::Audio)
        .ok_or_else(|| anyhow!("no audio stream"))?;
    let dec = ffmpeg::codec::Context::from_parameters(stream.parameters())?
        .decoder()
        .audio()?;
    let rate = if dec.rate() > 0 { dec.rate() } else { 48000 };
    Ok(rate)
}

// ── decode 线程 ───────────────────────────────────────────────────────────────

fn decode_loop(
    path: String,
    chapters: Arc<Vec<Chapter>>,
    initial_chapter_idx: usize,
    initial_seek_sec: f64,
    shared: Arc<Shared>,
) -> Result<()> {
    log::info!("decode_loop: opening {path}");
    let mut ictx = ffmpeg::format::input(&path).with_context(|| format!("open: {path}"))?;
    log::info!("decode_loop: input opened");

    let (stream_index, stream_tb_f, mut decoder, src_format, src_rate, src_layout, src_channels) = {
        let s = ictx
            .streams()
            .best(ffmpeg::media::Type::Audio)
            .ok_or_else(|| anyhow!("no audio stream"))?;
        let idx = s.index();
        let tb = s.time_base();
        let tb_f = tb.numerator() as f64 / tb.denominator() as f64;
        let codec_ctx = ffmpeg::codec::Context::from_parameters(s.parameters())?;
        let dec = codec_ctx.decoder().audio()?;
        let fmt = match dec.format() {
            ffmpeg::format::Sample::None => {
                ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar)
            }
            f => f,
        };
        let rate = if dec.rate() > 0 { dec.rate() } else { 48000 };
        let (layout, channels) = resolve_layout(&dec, &ictx, idx);
        (idx, tb_f, dec, fmt, rate, layout, channels)
    };

    log::info!(
        "decode_loop: stream_idx={stream_index} src_rate={src_rate} src_fmt={:?} src_layout=0x{:x} src_channels={src_channels}",
        src_format,
        src_layout.bits(),
    );

    let mut current_speed = shared.speed();
    log::info!("decode_loop: initial speed={current_speed}, creating atempo filter...");
    let mut atempo = match AtempoFilter::new(src_format, src_layout, src_rate, current_speed) {
        Ok(a) => {
            log::info!("decode_loop: atempo filter created");
            a
        }
        Err(e) => {
            log::error!("decode_loop: AtempoFilter::new FAILED: {e:?}");
            return Err(e);
        }
    };

    // 不再有应用层重采样：atempo 直接输出 mono/源采样率，cpal 流也配在源采样率上。

    let mut current_chapter_end = chapters[initial_chapter_idx].end_sec;
    log::info!("decode_loop: initial seek to {initial_seek_sec:.2}s");
    seek_to(
        &mut ictx,
        &mut decoder,
        stream_index,
        stream_tb_f,
        initial_seek_sec,
    )?;
    log::info!("decode_loop: initial seek done, entering main loop");

    let mut decoded = ffmpeg::frame::Audio::empty();
    let mut filtered = ffmpeg::frame::Audio::empty();
    let mut last_pos_sec = initial_seek_sec;
    let mut skip_until: Option<f64> = Some(initial_seek_sec);

    let _ = src_channels;

    'main: loop {
        if shared.should_exit.load(Ordering::Acquire) {
            break;
        }

        let pending = shared.seek_target.lock().unwrap().take();
        if let Some(target) = pending {
            seek_to(&mut ictx, &mut decoder, stream_index, stream_tb_f, target)?;
            current_speed = shared.speed();
            atempo = AtempoFilter::new(src_format, src_layout, src_rate, current_speed)?;
            shared
                .decoder_speed_gen
                .store(shared.speed_gen.load(Ordering::Acquire), Ordering::Release);
            current_chapter_end = *shared.current_chapter_end_sec.lock().unwrap();
            shared.chapter_decode_done.store(false, Ordering::Release);
            last_pos_sec = target;
            skip_until = Some(target);
            log::debug!("decode seek: {target:.2}s speed={current_speed}");
            continue 'main;
        }

        let cur_speed_gen = shared.speed_gen.load(Ordering::Acquire);
        if shared.decoder_speed_gen.load(Ordering::Acquire) != cur_speed_gen {
            current_speed = shared.speed();
            atempo = AtempoFilter::new(src_format, src_layout, src_rate, current_speed)?;
            shared
                .decoder_speed_gen
                .store(cur_speed_gen, Ordering::Release);
            log::debug!("decode: speed → {current_speed}");
        }

        // 有未被播放端消费的 seek（write_gen 已自增，但 cpal 还没清环 + 切 origin）时，
        // 解码先别继续生产、前进。否则：暂停状态下点章节会 seek 到章首并把 8s 环填满，
        // 但按下播放时 cpal 第一帧才检测到 gen 变化、清空整个环（丢掉刚填的章首音频），
        // 而解码位置此时已前进了 ~8s，于是"下一章从中间某处开始播放"。
        // gen 由 cpal 回调在播放时确认（read_gen 追上 write_gen），所以这里只在
        // “seek 后尚未真正开始播放”的窗口内阻塞，正常播放期间 read==write 不受影响。
        if shared.read_gen.load(Ordering::Acquire) != shared.write_gen.load(Ordering::Acquire) {
            park_decoder(&shared);
            continue 'main;
        }

        // 播完当前章就停：标记完成并 park，由前端在 playback-chapter-ended 事件里暂停。
        // 用户点下一章/上一章时，do_seek 会重置 chapter_decode_done 并唤醒解码线程。
        if last_pos_sec >= current_chapter_end {
            // 第一次到章末时把 atempo 内部缓冲 flush 出来，否则尾巴 ~一帧音频会丢。
            if !shared.chapter_decode_done.load(Ordering::Acquire) {
                atempo.send_eof().ok();
                while atempo.receive(&mut filtered).unwrap_or(false) {
                    push_samples(&filtered, &shared)?;
                }
                shared.chapter_decode_done.store(true, Ordering::Release);
            }
            park_decoder(&shared);
            continue 'main;
        }

        // 背压：ring 快满（剩余不到容量的 1/64，约 1/8 秒）时让解码线程歇着
        if shared.ring.vacant() < shared.ring.capacity / 64 {
            park_decoder(&shared);
            continue 'main;
        }

        match decoder.receive_frame(&mut decoded) {
            Ok(_) => {
                if let Some(pts) = decoded.pts() {
                    last_pos_sec = pts as f64 * stream_tb_f;
                }
                if let Some(target) = skip_until {
                    let eff = decoded
                        .pts()
                        .map(|p| p as f64 * stream_tb_f)
                        .unwrap_or(last_pos_sec);
                    if eff < target {
                        continue 'main;
                    }
                    skip_until = None;
                }

                // 到达章节结尾：这一帧已经属于下一章，不要推进 ring，
                // 否则播放会越界进下一章、进度/locate 跳到下一章，
                // 用户点"下一章"时还会因 index 已自增而多跳一章。
                if last_pos_sec >= current_chapter_end {
                    // flush atempo 内部缓冲，找回尾巴音频，再标记完成并 park。
                    if !shared.chapter_decode_done.load(Ordering::Acquire) {
                        atempo.send_eof().ok();
                        while atempo.receive(&mut filtered).unwrap_or(false) {
                            push_samples(&filtered, &shared)?;
                        }
                        shared.chapter_decode_done.store(true, Ordering::Release);
                    }
                    park_decoder(&shared);
                    continue 'main;
                }

                static FRAME_N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
                let fn_n = FRAME_N.fetch_add(1, Ordering::Relaxed);
                if fn_n % 100 == 0 {
                    log::debug!(
                        "decode frame #{fn_n}: samples={} pts={:?} last_pos={:.2}",
                        decoded.samples(),
                        decoded.pts(),
                        last_pos_sec,
                    );
                }

                if let Err(e) = atempo.send(&decoded) {
                    log::error!("atempo.send failed: {e:?}");
                    return Err(e);
                }
                loop {
                    match atempo.receive(&mut filtered) {
                        Ok(true) => {
                            // atempo 已输出 mono/fltp/源采样率，直接推入 ring
                            push_samples(&filtered, &shared)?;
                        }
                        Ok(false) => break,
                        Err(e) => {
                            log::error!("atempo.receive failed: {e:?}");
                            return Err(e);
                        }
                    }
                }
            }
            Err(ffmpeg::Error::Other {
                errno: ffmpeg::error::EAGAIN,
            }) => {
                if !feed_one_packet(&mut ictx, &mut decoder, stream_index)? {
                    decoder.send_eof().ok();
                    while decoder.receive_frame(&mut decoded).is_ok() {
                        atempo.send(&decoded)?;
                        while atempo.receive(&mut filtered)? {
                            push_samples(&filtered, &shared)?;
                        }
                    }
                    atempo.send_eof()?;
                    while atempo.receive(&mut filtered)? {
                        push_samples(&filtered, &shared)?;
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

    log::info!("decode thread exited main loop");
    Ok(())
}

// ── 辅助 ──────────────────────────────────────────────────────────────────────

fn seek_to(
    ictx: &mut ffmpeg::format::context::Input,
    decoder: &mut ffmpeg::decoder::Audio,
    stream_index: usize,
    tb_f: f64,
    sec: f64,
) -> Result<()> {
    use ffmpeg::ffi;
    use std::os::raw::c_int;
    let ts = (sec / tb_f) as i64;
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

fn push_samples(frame: &ffmpeg::frame::Audio, shared: &Arc<Shared>) -> Result<()> {
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
        if shared.seek_target.lock().unwrap().is_some() {
            return Ok(());
        }
        let pushed = shared.ring.push_slice(&slice[written..]);
        if pushed > 0 {
            written += pushed;
            shared
                .pushed_total
                .fetch_add(pushed as u64, Ordering::Relaxed);
            static N: std::sync::atomic::AtomicU64 = std::sync::atomic::AtomicU64::new(0);
            let cnt = N.fetch_add(1, Ordering::Relaxed);
            if cnt % 200 == 0 {
                log::debug!(
                    "push #{cnt}: ring.occupied={} pushed_total={}",
                    shared.ring.occupied(),
                    shared.pushed_total.load(Ordering::Relaxed),
                );
            }
        } else {
            park_decoder(shared);
        }
    }
    Ok(())
}

fn park_decoder(shared: &Arc<Shared>) {
    let (lock, cvar) = &shared.wake;
    let mut woken = lock.lock().unwrap();
    while !*woken
        && !shared.should_exit.load(Ordering::Acquire)
        && shared.seek_target.lock().unwrap().is_none()
    {
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
    let mut last_chapter_ended: Option<usize> = None;

    while !shared.should_exit.load(Ordering::Acquire) {
        thread::sleep(Duration::from_millis(PROGRESS_TICK_MS));

        if shared.read_gen.load(Ordering::Acquire) != shared.write_gen.load(Ordering::Acquire) {
            continue;
        }

        // 关键：变速时进度按速率换算
        // popped 是输出端样本数（变速后），换算回源音频秒数要乘以 speed
        let popped = shared.popped_total.load(Ordering::Acquire);
        let baseline = shared.origin_baseline.load(Ordering::Acquire);
        let played_output_samples = popped.saturating_sub(baseline);
        let speed = shared.speed() as f64;
        let played_source_sec = played_output_samples as f64 / output_rate as f64 * speed;
        let abs_sec = *shared.origin_sec.lock().unwrap() + played_source_sec;

        // 用引擎正在解码的章节作为权威 index：解码线程始终停在章末，
        // current_chapter_idx 在 seek/open 时设定，章内播放期间恒定。
        // 不用 locate_chapter，避免章末越界一帧时进度跳到下一章。
        let chapter_idx = shared
            .current_chapter_idx
            .load(Ordering::Acquire)
            .min(chapters.len().saturating_sub(1));
        let ch = &chapters[chapter_idx];
        let ch_dur = (ch.end_sec - ch.start_sec).max(0.0);
        let is_playing = shared.playing.load(Ordering::Acquire);

        let decode_done = shared.chapter_decode_done.load(Ordering::Acquire);
        let ring_empty = shared.ring.occupied() == 0;
        let has_played = popped > baseline;

        // 章节完整播完时把进度吸附到章末：atempo 内部 latency 会让按 popped 估算的
        // 位置比章末短 ~50ms，前端 floor 后会显示成"差 1 秒"（如 17:30 vs 17:31）。
        let chapter_pos = if decode_done && ring_empty && has_played {
            ch_dur
        } else {
            (abs_sec - ch.start_sec).clamp(0.0, ch_dur)
        };

        if decode_done && ring_empty && is_playing && has_played {
            let cur = shared.current_chapter_idx.load(Ordering::Acquire);
            if last_chapter_ended != Some(cur) {
                last_chapter_ended = Some(cur);
                let _ = app.emit(
                    "playback-chapter-ended",
                    serde_json::json!({ "chapterIndex": cur }),
                );
                log::info!("chapter {cur} ended");
            }
        } else if !decode_done {
            last_chapter_ended = None;
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
