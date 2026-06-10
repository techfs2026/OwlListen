//! audioplayer — OwlListen 通用音频播放器底层。
//!
//! 当前提供两层可复用能力，供精听（BufferSource）与泛听（StreamSource）共享：
//!
//! - [`atempo`]：FFmpeg `atempo` filter graph 封装，变速不变调；
//! - [`output`]：cpal 输出层 [`OutputSink`]，管理设备输出流、淡入与 underrun，
//!   通过 [`SampleSource`] trait 从任意音源（ring 流式 / 内存 buffer）拉取样本。
//!
//! 数据供给层（StreamSource / BufferSource）由调用方实现 [`SampleSource`]。

pub mod atempo;
pub mod buffer;
pub mod output;

pub use atempo::AtempoFilter;
pub use buffer::BufferSource;
pub use output::{ClockSnapshot, FillInfo, OutputSink, PlaybackClock, SampleSource};
