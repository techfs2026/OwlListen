import React, { useEffect, useState } from "react";
import type { AudiobookCover, AudiobookMeta, Chapter } from "@/utils/audiobookApi";
import type { PlayState } from "@/hooks/useAudiobook";
import { PlayingBarsLarge } from "./icons";
import "./NowPlaying.scss";

interface NowPlayingProps {
  meta: AudiobookMeta;
  chapter: Chapter | null;
  chapterIndex: number;
  totalChapters: number;
  playState: PlayState;
  cover: AudiobookCover | null;
}

function titleToGradient(title: string): string {
  let hash = 0;
  for (let i = 0; i < title.length; i++) {
    hash = (hash * 31 + title.charCodeAt(i)) >>> 0;
  }
  const palettes = [
    ["#6366F1", "#8B5CF6"], ["#0EA5E9", "#6366F1"],
    ["#10B981", "#0EA5E9"], ["#F59E0B", "#EF4444"],
    ["#EC4899", "#8B5CF6"], ["#14B8A6", "#6366F1"],
    ["#F97316", "#EC4899"], ["#84CC16", "#10B981"],
  ];
  const [a, b] = palettes[hash % palettes.length];
  return `linear-gradient(135deg, ${a}, ${b})`;
}

export function NowPlaying({
  meta, chapter, chapterIndex, totalChapters, playState, cover,
}: NowPlayingProps) {
  const [imgLoaded, setImgLoaded] = useState(false);
  const [imgError, setImgError] = useState(false);
  const gradient = titleToGradient(meta.title);

  // 用 base64 数据本身作为标识，相同图片不重置（避免无谓闪烁）
  const coverKey = cover?.data ?? "";

  // cover 变化时重置加载状态
  useEffect(() => {
    setImgLoaded(false);
    setImgError(false);
  }, [coverKey]);

  const coverSrc = cover && !imgError
    ? `data:${cover.mimeType};base64,${cover.data}`
    : null;

  const showCover = coverSrc && imgLoaded;

  return (
    <div className="now-playing">
      <div
        className="now-playing__cover"
        style={{ background: showCover ? "transparent" : gradient }}
      >
        {coverSrc && (
          <img
            // key 强制 React 在 src 变化时重新挂载 <img>，
            // 保证 onLoad 一定触发（即使 base64 已被浏览器缓存解码）
            key={coverKey}
            src={coverSrc}
            alt={meta.title}
            className="now-playing__cover-img"
            style={{ opacity: imgLoaded ? 1 : 0 }}
            draggable={false}
            onLoad={() => setImgLoaded(true)}
            onError={() => setImgError(true)}
          />
        )}
        {!showCover && (
          <span className="now-playing__cover-initial">
            {(meta.title || "?")[0].toUpperCase()}
          </span>
        )}
        {playState === "playing" && (
          <div className="now-playing__playing-badge">
            <PlayingBarsLarge />
          </div>
        )}
      </div>

      <div className="now-playing__meta">
        <div className="now-playing__title">{meta.title}</div>
        {meta.author && <div className="now-playing__author">{meta.author}</div>}
      </div>

      {chapter && (
        <div className="now-playing__chapter">
          <div className="now-playing__chapter-badge">
            第 {chapterIndex + 1} / {totalChapters} 章
          </div>
          <div className="now-playing__chapter-title">{chapter.title}</div>
        </div>
      )}
    </div>
  );
}