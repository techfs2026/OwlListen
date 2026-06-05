pub mod builder;
pub mod extractor;
pub mod peak;
pub mod view;

pub use extractor::extract;
pub use peak::WaveformSummary;
pub use view::{ChannelRenderData, RenderMode, ViewRange};
