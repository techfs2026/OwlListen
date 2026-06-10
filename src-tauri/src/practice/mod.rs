//! practice — 精听播放引擎。
//!
//! 基于 `audioplayer::BufferSource`（整段解码进内存）+ `audioplayer::OutputSink`，
//! 与泛听共用 cpal 输出层，但走内存 buffer 路径以支持后续的采样级区间/循环。
//! 本步先跑通基础播放 + seek + 进度事件。

pub mod playback;

pub use playback::PracticePlayer;
