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

export function toAssetUrl(path: string): string {
  return convertFileSrc(path);
}