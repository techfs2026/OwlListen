import { invoke } from "@tauri-apps/api/core";
import { convertFileSrc } from "@tauri-apps/api/core";

export interface Chapter {
  index: number;
  title: string;
  startSec: number;
  endSec: number;
}

export interface AudiobookMeta {
  title: string;
  author: string;
  durationSec: number;
  chapters: Chapter[];
}

export interface BookProgress {
  chapterIndex: number;
  positionSec: number;
}

export interface RecentBook {
  path: string;
  title: string;
  author: string;
  lastOpened: number; // Unix timestamp (seconds)
}

export interface AudiobookCover {
  data: string;      // base64
  mimeType: string;  // "image/jpeg" | "image/png"
}

export async function loadAudiobook(path: string): Promise<AudiobookMeta> {
  return invoke<AudiobookMeta>("load_audiobook", { path });
}

export async function getAudiobookProgress(bookPath: string): Promise<BookProgress> {
  return invoke<BookProgress>("get_audiobook_progress", { bookPath });
}

export async function saveAudiobookProgress(
  bookPath: string,
  chapterIndex: number,
  positionSec: number,
): Promise<void> {
  return invoke("save_audiobook_progress", { bookPath, chapterIndex, positionSec });
}

export async function getRecentAudiobooks(): Promise<RecentBook[]> {
  return invoke<RecentBook[]>("get_recent_audiobooks");
}

export async function pushRecentAudiobook(
  bookPath: string,
  title: string,
  author: string,
): Promise<void> {
  return invoke("push_recent_audiobook", { bookPath, title, author });
}

export async function getAudiobookCover(path: string): Promise<AudiobookCover | null> {
  return invoke<AudiobookCover | null>("get_audiobook_cover", { path });
}

export function toAssetUrl(path: string): string {
  return convertFileSrc(path);
}

export async function removeRecentAudiobook(path: string): Promise<void> {
  return invoke("remove_recent_audiobook", { bookPath: path });
}

export async function playbackOpen(
  path: string,
  chapterIndex: number,
  positionSec: number,
): Promise<void> {
  return invoke("playback_open", { path, chapterIndex, positionSec });
}

export async function playbackPlay(): Promise<void> {
  return invoke("playback_play");
}

export async function playbackPause(): Promise<void> {
  return invoke("playback_pause");
}

export async function playbackClose(): Promise<void> {
  return invoke("playback_close");
}

export async function playbackSeek(
  chapterIndex: number,
  positionSec: number,
): Promise<void> {
  return invoke("playback_seek", { chapterIndex, positionSec });
}

export interface PlaybackProgressEvent {
  chapterIndex: number;
  positionSec: number;
  playing: boolean;
}

export interface PlaybackChapterEndedEvent {
  chapterIndex: number;
}