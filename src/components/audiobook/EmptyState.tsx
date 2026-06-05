import { useState } from "react";
import type { RecentBook } from "@/utils/audiobookApi";
import { CloseIcon } from "./icons";
import "./EmptyState.scss";

interface EmptyStateProps {
  recentBooks: RecentBook[];
  onOpenRecent: (book: RecentBook) => void;
  onRemoveRecent: (book: RecentBook) => void;
}

function pathBasename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function EmptyState({
  recentBooks, onOpenRecent, onRemoveRecent,
}: EmptyStateProps) {
  const [hoverPath, setHoverPath] = useState<string | null>(null);

  return (
    <div className="empty-state">
      <div className="empty-state__icon">📖</div>
      <p className="empty-state__title">还没有打开有声书</p>
      <p className="empty-state__hint">支持 M4B</p>
      <p className="empty-state__drag">从顶部「打开有声书」选择，或直接拖入文件</p>

      {recentBooks.length > 0 && (
        <div className="empty-state__recent">
          <div className="empty-state__recent-header">最近打开</div>
          <div className="empty-state__recent-list">
            {recentBooks.map((book) => (
              <div
                key={book.path}
                className="recent-card"
                onMouseEnter={() => setHoverPath(book.path)}
                onMouseLeave={() => setHoverPath(null)}
              >
                <button
                  className="recent-card__main"
                  onClick={() => onOpenRecent(book)}
                  title={book.path}
                >
                  <div className="recent-card__emoji">📚</div>
                  <div className="recent-card__meta">
                    <div className="recent-card__title">
                      {book.title || pathBasename(book.path)}
                    </div>
                    {book.author && (
                      <div className="recent-card__author">{book.author}</div>
                    )}
                  </div>
                </button>
                <button
                  className={`recent-card__remove${hoverPath === book.path ? " recent-card__remove--visible" : ""
                    }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onRemoveRecent(book);
                  }}
                  title="从最近列表移除"
                >
                  <CloseIcon />
                </button>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}