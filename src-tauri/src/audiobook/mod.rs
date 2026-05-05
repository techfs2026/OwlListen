pub mod chapters;
pub mod playback;
pub mod progress;

pub use chapters::{parse_audiobook, AudiobookMeta, Chapter};
pub use playback::PlaybackEngine;
pub use progress::{get_progress, set_progress, BookProgress};
pub use progress::{get_recent_books, push_recent_book, remove_recent_book, RecentBook};