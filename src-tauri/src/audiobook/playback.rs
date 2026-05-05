/// playback.rs — macOS CoreAudio AudioUnit 后端
///
/// # 架构
///
/// ```text
/// Tauri命令线程
///     │  seek_in_chapter() → write_gen++ + seek_target
///     │  play/pause        → AU start/stop
///     ↓
/// decode线程（FFmpeg）
///     │  检测 seek_target → av_seek_frame → 重建 resampler
///     │  push PCM帧到 SpscRing
///     ↓
/// SpscRing（自己实现的 lock-free SPSC ring buffer，mono f32）
///     ↓
/// CoreAudio render callback（系统音频线程）
///     │  检测 read_gen != write_gen → drain ring → 切换 origin → 淡入
///     │  正常 pop → 应用淡入包络 → 写入输出 buffer
///     ↓
/// 硬件输出
/// ```
///
/// # 关于 ring buffer
///
/// 之前用 ringbuf crate 的 HeapCons/HeapProd 遇到了 Caching 视图缓存不同步的问题：
/// consumer drain 后，producer 的 try_push 仍然返回 0，因为 Caching 视图不感知。
/// 这里改用自己实现的简单 SPSC，所有同步通过共享原子量完成，drain 立即对另一端可见。
///
/// # seek 不爆音原理
///
/// seek 协议在 render callback 内部原子完成，不依赖跨线程握手：
///
/// 1. do_seek 写好 pending_origin_*，最后递增 write_gen（Release）
/// 2. render callback 每次开头检查 read_gen vs write_gen：
///    - 不同 → drain ring → 切换 origin → read_gen = write_gen → fade_mult = 0
///    - 相同 → 正常消费
/// 3. drain + 切换在同一次调用内完成，旧数据不会混入新数据

use anyhow::{anyhow, Context, Result};
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
/// 淡入步长：每个采样增加 1/FADE_STEPS，48kHz 下约 42ms 升满
const FADE_STEPS: f32 = 2000.0;

// ── SpscRing：单生产者单消费者无锁环形缓冲 ──────────────────────────────────

/// 简单的 SPSC ring buffer，f32 元素。
/// 索引使用单调递增 u64（不取模），位置 = idx % capacity。
/// head 由 producer 推进，tail 由 consumer 推进，原子量同步，无内部缓存视图。
struct SpscRing {
    buf: Box<[std::cell::UnsafeCell<f32>]>,
    capacity: usize,
    head: AtomicU64,
    tail: AtomicU64,
}

// SAFETY：SPSC 模式下，producer 和 consumer 各自只访问独占的索引区间，
// 通过 head/tail 原子量同步。
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

    /// Producer 端：批量写入
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

    /// Consumer 端：弹出一个
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

    /// Consumer 端：清空
    fn clear(&self) {
        let h = self.head.load(Ordering::Acquire);
        self.tail.store(h, Ordering::Release);
    }
}

// ── 共享状态 ──────────────────────────────────────────────────────────────────

struct Shared {
    ring: SpscRing,

    // 进度计数（独立于 ring 的 head/tail，因为要排除 drain 的部分）
    popped_total: AtomicU64,
    pushed_total: AtomicU64,
    origin_baseline: AtomicU64,
    origin_sec: Mutex<f64>,

    // seek / generation 协议
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

    // 变速
    speed_bits: AtomicU32,
}

impl Shared {
    fn wake_decoder(&self) {
        let (lock, cvar) = &self.wake;
        let mut w = lock.lock().unwrap();
        *w = true;
        cvar.notify_one();
    }

    #[allow(dead_code)]
    fn speed(&self) -> f32 {
        f32::from_bits(self.speed_bits.load(Ordering::Relaxed))
    }
}

// ── PlaybackEngine ────────────────────────────────────────────────────────────

pub struct PlaybackEngine {
    shared: Arc<Shared>,
    chapters: Arc<Vec<Chapter>>,
    output_sample_rate: u32,

    #[cfg(target_os = "macos")]
    audio_unit: core_audio::OutputUnit,

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

        #[cfg(target_os = "macos")]
        let output_sample_rate = core_audio::default_output_sample_rate().unwrap_or(48000);
        #[cfg(not(target_os = "macos"))]
        let output_sample_rate: u32 = 48000;

        log::info!("PlaybackEngine: rate={output_sample_rate}");

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
        });

        #[cfg(target_os = "macos")]
        let audio_unit = core_audio::build_output_unit(shared.clone(), output_sample_rate)
            .context("CoreAudio build_output_unit")?;

        let chapters_arc = Arc::new(chapters);
        let decode_shared = shared.clone();
        let decode_chapters = chapters_arc.clone();
        let decode_path = path.to_string();
        let decode_handle = thread::Builder::new()
            .name("audiobook-decode".into())
            .spawn(move || {
                if let Err(e) = decode_loop(
                    decode_path,
                    decode_chapters,
                    chapter_idx,
                    abs_start,
                    output_sample_rate,
                    decode_shared,
                ) {
                    log::error!("decode thread: {e:?}");
                }
            })
            .context("spawn decode thread")?;

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
            #[cfg(target_os = "macos")]
            audio_unit,
            decode_handle: Some(decode_handle),
            progress_handle: Some(progress_handle),
        })
    }

    pub fn play(&self) -> Result<()> {
        log::info!("PlaybackEngine::play()");
        #[cfg(target_os = "macos")]
        self.audio_unit.start().map_err(|e| anyhow!("AU start: {e}"))?;
        self.shared.playing.store(true, Ordering::Release);
        self.shared.wake_decoder();
        Ok(())
    }

    pub fn pause(&self) -> Result<()> {
        log::info!("PlaybackEngine::pause()");
        #[cfg(target_os = "macos")]
        self.audio_unit.stop().map_err(|e| anyhow!("AU stop: {e}"))?;
        self.shared.playing.store(false, Ordering::Release);
        Ok(())
    }

    pub fn set_speed(&self, speed: f32) -> Result<()> {
        let clamped = speed.clamp(0.25, 4.0);
        self.shared.speed_bits.store(clamped.to_bits(), Ordering::Relaxed);
        self.shared.wake_decoder();
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
        s.pending_origin_baseline.store(cur_popped, Ordering::Relaxed);
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
        #[cfg(target_os = "macos")]
        let _ = self.audio_unit.stop();
        if let Some(h) = self.decode_handle.take() {
            let _ = h.join();
        }
        if let Some(h) = self.progress_handle.take() {
            let _ = h.join();
        }
        log::info!("PlaybackEngine dropped");
    }
}

// ── CoreAudio 封装（仅 macOS）────────────────────────────────────────────────

#[cfg(target_os = "macos")]
mod core_audio {
    use super::{Shared, FADE_STEPS};
    use anyhow::{anyhow, Result};
    use coreaudio_sys::*;
    use std::mem;
    use std::os::raw::c_void;
    use std::sync::atomic::Ordering;
    use std::sync::Arc;

    struct RenderCtx {
        shared: Arc<Shared>,
        fade_mult: f32,
        prev_sample: f32,
    }

    unsafe extern "C" fn render_cb(
        in_ref_con: *mut c_void,
        _flags: *mut AudioUnitRenderActionFlags,
        _ts: *const AudioTimeStamp,
        _bus: u32,
        n_frames: u32,
        io_data: *mut AudioBufferList,
    ) -> OSStatus {
        let ctx = &mut *(in_ref_con as *mut RenderCtx);
        let frames = n_frames as usize;
        let shared = &ctx.shared;

        // gen 切换
        let write_gen = shared.write_gen.load(Ordering::Acquire);
        if shared.read_gen.load(Ordering::Relaxed) != write_gen {
            shared.ring.clear();

            let new_baseline = shared.pending_origin_baseline.load(Ordering::Acquire);
            shared.origin_baseline.store(new_baseline, Ordering::Release);

            if let Ok(mut guard) = shared.pending_origin_sec.try_lock() {
                if let Some(sec) = guard.take() {
                    if let Ok(mut orig) = shared.origin_sec.try_lock() {
                        *orig = sec;
                    }
                }
            }

            shared.read_gen.store(write_gen, Ordering::Release);

            ctx.fade_mult = 0.0;
            ctx.prev_sample = 0.0;

            log::debug!("render: gen→{write_gen}");
        }

        // 输出 buffer（裸指针偏移避免数组越界）
        let buf_list = &*io_data;
        let n_bufs = buf_list.mNumberBuffers as usize;
        if n_bufs == 0 {
            return 0;
        }
        let buffers_base = buf_list.mBuffers.as_ptr();

        let buf0_meta = &*buffers_base;
        let buf0 = std::slice::from_raw_parts_mut(buf0_meta.mData as *mut f32, frames);

        let mut extra: Vec<&mut [f32]> = (1..n_bufs)
            .filter_map(|i| {
                let buf_meta = &*buffers_base.add(i);
                let ptr = buf_meta.mData as *mut f32;
                if ptr.is_null() {
                    None
                } else {
                    Some(std::slice::from_raw_parts_mut(ptr, frames))
                }
            })
            .collect();

        let mut popped = 0u64;

        for i in 0..frames {
            let s = if let Some(val) = shared.ring.try_pop() {
                if ctx.fade_mult < 1.0 {
                    ctx.fade_mult = (ctx.fade_mult + 1.0 / FADE_STEPS).min(1.0);
                }
                let out = val * ctx.fade_mult;
                ctx.prev_sample = out;
                popped += 1;
                out
            } else {
                ctx.fade_mult = 0.0;
                ctx.prev_sample *= 0.95;
                if ctx.prev_sample.abs() < 1e-5 {
                    ctx.prev_sample = 0.0;
                }
                ctx.prev_sample
            };

            buf0[i] = s;
            for ch in extra.iter_mut() {
                ch[i] = s;
            }
        }

        shared.popped_total.fetch_add(popped, Ordering::Relaxed);
        shared.wake_decoder();

        0
    }

    pub fn default_output_sample_rate() -> Result<u32> {
        unsafe {
            let desc = AudioComponentDescription {
                componentType: kAudioUnitType_Output,
                componentSubType: kAudioUnitSubType_DefaultOutput,
                componentManufacturer: kAudioUnitManufacturer_Apple,
                componentFlags: 0,
                componentFlagsMask: 0,
            };
            let comp = AudioComponentFindNext(std::ptr::null_mut(), &desc);
            if comp.is_null() {
                return Ok(48000);
            }
            let mut unit: AudioUnit = std::ptr::null_mut();
            if AudioComponentInstanceNew(comp, &mut unit) != 0 {
                return Ok(48000);
            }
            let mut rate: f64 = 48000.0;
            let mut size = mem::size_of::<f64>() as u32;
            AudioUnitGetProperty(
                unit,
                kAudioUnitProperty_SampleRate,
                kAudioUnitScope_Output,
                0,
                &mut rate as *mut f64 as *mut c_void,
                &mut size,
            );
            AudioComponentInstanceDispose(unit);
            Ok(rate as u32)
        }
    }

    pub struct OutputUnit {
        unit: AudioUnit,
        _ctx: *mut RenderCtx,
    }

    impl Drop for OutputUnit {
        fn drop(&mut self) {
            unsafe {
                AudioOutputUnitStop(self.unit);
                AudioUnitUninitialize(self.unit);
                AudioComponentInstanceDispose(self.unit);
                drop(Box::from_raw(self._ctx));
            }
        }
    }

    unsafe impl Send for OutputUnit {}
    unsafe impl Sync for OutputUnit {}

    impl OutputUnit {
        pub fn start(&self) -> Result<()> {
            let ret = unsafe { AudioOutputUnitStart(self.unit) };
            if ret != 0 { Err(anyhow!("AudioOutputUnitStart: {ret}")) } else { Ok(()) }
        }

        pub fn stop(&self) -> Result<()> {
            let ret = unsafe { AudioOutputUnitStop(self.unit) };
            if ret != 0 { Err(anyhow!("AudioOutputUnitStop: {ret}")) } else { Ok(()) }
        }
    }

    pub fn build_output_unit(shared: Arc<Shared>, output_sample_rate: u32) -> Result<OutputUnit> {
        unsafe {
            let desc = AudioComponentDescription {
                componentType: kAudioUnitType_Output,
                componentSubType: kAudioUnitSubType_DefaultOutput,
                componentManufacturer: kAudioUnitManufacturer_Apple,
                componentFlags: 0,
                componentFlagsMask: 0,
            };
            let comp = AudioComponentFindNext(std::ptr::null_mut(), &desc);
            if comp.is_null() {
                return Err(anyhow!("AudioComponentFindNext: DefaultOutput not found"));
            }

            let mut unit: AudioUnit = std::ptr::null_mut();
            let ret = AudioComponentInstanceNew(comp, &mut unit);
            if ret != 0 {
                return Err(anyhow!("AudioComponentInstanceNew: {ret}"));
            }

            let format = AudioStreamBasicDescription {
                mSampleRate: output_sample_rate as f64,
                mFormatID: kAudioFormatLinearPCM,
                mFormatFlags: kAudioFormatFlagIsFloat
                    | kAudioFormatFlagIsNonInterleaved
                    | kAudioFormatFlagIsPacked,
                mBitsPerChannel: 32,
                mChannelsPerFrame: 2,
                mFramesPerPacket: 1,
                mBytesPerFrame: 4,
                mBytesPerPacket: 4,
                mReserved: 0,
            };
            let ret = AudioUnitSetProperty(
                unit,
                kAudioUnitProperty_StreamFormat,
                kAudioUnitScope_Input,
                0,
                &format as *const _ as *const c_void,
                mem::size_of::<AudioStreamBasicDescription>() as u32,
            );
            if ret != 0 {
                AudioComponentInstanceDispose(unit);
                return Err(anyhow!("SetProperty StreamFormat: {ret}"));
            }

            let ctx = Box::new(RenderCtx {
                shared,
                fade_mult: 0.0,
                prev_sample: 0.0,
            });
            let ctx_ptr = Box::into_raw(ctx);

            let callback = AURenderCallbackStruct {
                inputProc: Some(render_cb),
                inputProcRefCon: ctx_ptr as *mut c_void,
            };
            let ret = AudioUnitSetProperty(
                unit,
                kAudioUnitProperty_SetRenderCallback,
                kAudioUnitScope_Input,
                0,
                &callback as *const _ as *const c_void,
                mem::size_of::<AURenderCallbackStruct>() as u32,
            );
            if ret != 0 {
                drop(Box::from_raw(ctx_ptr));
                AudioComponentInstanceDispose(unit);
                return Err(anyhow!("SetProperty RenderCallback: {ret}"));
            }

            let ret = AudioUnitInitialize(unit);
            if ret != 0 {
                drop(Box::from_raw(ctx_ptr));
                AudioComponentInstanceDispose(unit);
                return Err(anyhow!("AudioUnitInitialize: {ret}"));
            }

            log::info!("CoreAudio OutputUnit ready, rate={output_sample_rate}");
            Ok(OutputUnit { unit, _ctx: ctx_ptr })
        }
    }
}

// ── decode 线程 ───────────────────────────────────────────────────────────────

fn decode_loop(
    path: String,
    chapters: Arc<Vec<Chapter>>,
    initial_chapter_idx: usize,
    initial_seek_sec: f64,
    output_rate: u32,
    shared: Arc<Shared>,
) -> Result<()> {
    let mut ictx = ffmpeg::format::input(&path).with_context(|| format!("open: {path}"))?;

    let (stream_index, stream_tb_f, mut decoder, src_format, src_rate, src_layout) = {
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
        let (layout, _) = resolve_layout(&dec, &ictx, idx);
        (idx, tb_f, dec, fmt, rate, layout)
    };

    let mut resampler = make_resampler(src_format, src_layout, src_rate, output_rate)?;

    let mut current_chapter_end = chapters[initial_chapter_idx].end_sec;
    seek_to(&mut ictx, &mut decoder, stream_index, stream_tb_f, initial_seek_sec)?;

    let mut decoded = ffmpeg::frame::Audio::empty();
    let mut resampled = ffmpeg::frame::Audio::empty();
    let mut last_pos_sec = initial_seek_sec;
    let mut skip_until: Option<f64> = Some(initial_seek_sec);

    'main: loop {
        if shared.should_exit.load(Ordering::Acquire) {
            break;
        }

        let pending = shared.seek_target.lock().unwrap().take();
        if let Some(target) = pending {
            seek_to(&mut ictx, &mut decoder, stream_index, stream_tb_f, target)?;
            resampler = make_resampler(src_format, src_layout, src_rate, output_rate)?;
            current_chapter_end = *shared.current_chapter_end_sec.lock().unwrap();
            shared.chapter_decode_done.store(false, Ordering::Release);
            last_pos_sec = target;
            skip_until = Some(target);
            log::debug!("decode seek: {target:.2}s");
            continue 'main;
        }

        if last_pos_sec >= current_chapter_end {
            shared.chapter_decode_done.store(true, Ordering::Release);
            park_decoder(&shared);
            continue 'main;
        }

        if shared.ring.vacant() < (output_rate as usize / 8) {
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
                resampler.run(&decoded, &mut resampled)?;
                push_samples(&resampled, &shared)?;
            }
            Err(ffmpeg::Error::Other { errno: ffmpeg::error::EAGAIN }) => {
                if !feed_one_packet(&mut ictx, &mut decoder, stream_index)? {
                    decoder.send_eof().ok();
                    while decoder.receive_frame(&mut decoded).is_ok() {
                        resampler.run(&decoded, &mut resampled)?;
                        push_samples(&resampled, &shared)?;
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

// ── 辅助 ──────────────────────────────────────────────────────────────────────

fn make_resampler(
    src_fmt: ffmpeg::format::Sample,
    src_layout: ffmpeg::channel_layout::ChannelLayout,
    src_rate: u32,
    dst_rate: u32,
) -> Result<ffmpeg::software::resampling::Context> {
    ffmpeg::software::resampling::Context::get(
        src_fmt,
        src_layout,
        src_rate,
        ffmpeg::format::Sample::F32(ffmpeg::format::sample::Type::Planar),
        ffmpeg::channel_layout::ChannelLayout::MONO,
        dst_rate,
    )
    .map_err(|e| anyhow!("resampler: {e}"))
}

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
            shared.pushed_total.fetch_add(pushed as u64, Ordering::Relaxed);
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
        let r = cvar.wait_timeout(woken, Duration::from_millis(200)).unwrap();
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
    let mut last_chapter_ended: Option<usize> = None;

    while !shared.should_exit.load(Ordering::Acquire) {
        thread::sleep(Duration::from_millis(PROGRESS_TICK_MS));

        if shared.read_gen.load(Ordering::Acquire) != shared.write_gen.load(Ordering::Acquire) {
            continue;
        }

        let popped = shared.popped_total.load(Ordering::Acquire);
        let baseline = shared.origin_baseline.load(Ordering::Acquire);
        let played = popped.saturating_sub(baseline);
        let abs_sec = *shared.origin_sec.lock().unwrap() + played as f64 / output_rate as f64;

        let (chapter_idx, chapter_pos) = locate_chapter(&chapters, abs_sec);
        let is_playing = shared.playing.load(Ordering::Acquire);

        let decode_done = shared.chapter_decode_done.load(Ordering::Acquire);
        let ring_empty = shared.ring.occupied() == 0;
        let has_played = popped > baseline;

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