//! 波形渲染数据管线
//!
//! 模块结构:
//!   peak.rs      - Peak / ChannelPyramid / WaveformSummary
//!                  (RawSamples 定义在 crate::audio::decoder)
//!   builder.rs   - 构建多声道金字塔(rayon 并行 + wide SIMD)
//!   view.rs      - ViewRange / RenderMode / RenderData
//!   extractor.rs - 三模式分发:Envelope / Polyline / Stem
//!
//! 典型使用:
//! ```ignore
//! use crate::audio::decoder;
//! use crate::waveform::{builder, extractor, ViewRange};
//!
//! let audio = decoder::decode_audio("a.wav", 48_000)?;
//! let summary = builder::build_summary(&audio);
//! let view = ViewRange { start_sec: 0.0, end_sec: 10.0, pixel_width: 1280 };
//! let render = extractor::extract(&summary, &view);
//! // 把 render.channels 交给 UI 层绘制
//! ```

pub mod builder;
pub mod extractor;
pub mod peak;
pub mod view;

pub use extractor::extract;
pub use peak::{ChannelPyramid, Peak, WaveformSummary};
pub use view::{ChannelRenderData, RenderData, RenderMode, ViewRange};