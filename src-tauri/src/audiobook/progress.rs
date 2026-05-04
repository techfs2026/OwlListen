use anyhow::Result;
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct BookProgress {
    /// 上次播放的章节索引
    pub chapter_index: usize,
    /// 章节内的秒数偏移
    pub position_sec: f64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RecentBook {
    pub path: String,
    pub title: String,
    pub author: String,
    /// Unix timestamp (seconds) of last opened
    pub last_opened: u64,
}

/// key: 音频文件的绝对路径
type ProgressMap = HashMap<String, BookProgress>;

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct StorageFile {
    progress: ProgressMap,
    recent_books: Vec<RecentBook>,
}

const MAX_RECENT: usize = 10;

fn storage_file(app_data_dir: &str) -> PathBuf {
    PathBuf::from(app_data_dir).join("audiobook_progress.json")
}

fn load_storage(app_data_dir: &str) -> StorageFile {
    let path = storage_file(app_data_dir);
    if !path.exists() {
        return StorageFile::default();
    }
    std::fs::read_to_string(&path)
        .ok()
        .and_then(|s| serde_json::from_str(&s).ok())
        .unwrap_or_default()
}

fn save_storage(app_data_dir: &str, store: &StorageFile) -> Result<()> {
    let path = storage_file(app_data_dir);
    if let Some(parent) = path.parent() {
        std::fs::create_dir_all(parent)?;
    }
    let json = serde_json::to_string_pretty(store)?;
    std::fs::write(&path, json)?;
    Ok(())
}

pub fn get_progress(app_data_dir: &str, book_path: &str) -> BookProgress {
    load_storage(app_data_dir)
        .progress
        .remove(book_path)
        .unwrap_or_default()
}

pub fn set_progress(
    app_data_dir: &str,
    book_path: &str,
    progress: BookProgress,
) -> Result<()> {
    let mut store = load_storage(app_data_dir);
    store.progress.insert(book_path.to_string(), progress);
    save_storage(app_data_dir, &store)
}

pub fn get_recent_books(app_data_dir: &str) -> Vec<RecentBook> {
    load_storage(app_data_dir).recent_books
}

pub fn push_recent_book(
    app_data_dir: &str,
    path: &str,
    title: &str,
    author: &str,
) -> Result<()> {
    let mut store = load_storage(app_data_dir);

    // 移除已有同路径条目
    store.recent_books.retain(|b| b.path != path);

    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs())
        .unwrap_or(0);

    store.recent_books.insert(
        0,
        RecentBook {
            path: path.to_string(),
            title: title.to_string(),
            author: author.to_string(),
            last_opened: now,
        },
    );

    // 只保留最近 MAX_RECENT 本
    store.recent_books.truncate(MAX_RECENT);

    save_storage(app_data_dir, &store)
}

pub fn remove_recent_book(app_data_dir: &str, path: &str) -> Result<()> {
    let mut store = load_storage(app_data_dir);
    store.recent_books.retain(|b| b.path != path);
    save_storage(app_data_dir, &store)
}