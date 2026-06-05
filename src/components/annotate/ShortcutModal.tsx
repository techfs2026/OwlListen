// 初次精听 标注模式的键盘 / 鼠标快捷键弹窗。
// 复用全局 .modal-overlay + .modal-card + .kbd 样式（与精听 / 听有声书一致）。

const SHORTCUT_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: "键盘",
    items: [
      { key: "空格", label: "播放 / 暂停" },
      { key: "L", label: "切换回环" },
      { key: "← / →", label: "上一段 / 下一段" },
      { key: "H", label: "显示 / 隐藏帮助" },
    ],
  },
  {
    group: "鼠标 · 波形",
    items: [
      { key: "拖拽", label: "框选新片段（自动回环）" },
      { key: "拖边缘", label: "调整片段边界" },
      { key: "单击", label: "定位播放头" },
      { key: "滚轮", label: "左右平移" },
      { key: "⌘ + 滚轮", label: "缩放" },
    ],
  },
];

interface ShortcutModalProps {
  onClose: () => void;
}

export function ShortcutModal({ onClose }: ShortcutModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__title">键盘快捷键</div>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "4px 32px" }}>
          {SHORTCUT_GROUPS.map((group) => (
            <div
              key={group.group}
              style={{ display: "flex", flexDirection: "column", gap: 0, marginBottom: 16 }}
            >
              <div
                style={{
                  fontFamily: "var(--font-mono)",
                  fontSize: "var(--font-size-xs)",
                  letterSpacing: "0.08em",
                  textTransform: "uppercase",
                  color: "var(--color-ink-3)",
                  marginBottom: 6,
                  borderBottom: "0.5px solid var(--color-border)",
                  paddingBottom: "var(--space-1)",
                }}
              >
                {group.group}
              </div>
              {group.items.map(({ key, label }) => (
                <div
                  key={key}
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: "var(--space-3)",
                    padding: "5px 0",
                  }}
                >
                  <kbd className="kbd">{key}</kbd>
                  <span
                    style={{
                      fontSize: "var(--font-size-base)",
                      color: "var(--color-ink-1)",
                      fontFamily: "var(--font-sans)",
                    }}
                  >
                    {label}
                  </span>
                </div>
              ))}
            </div>
          ))}
        </div>

        <div className="modal-card__footer">
          按 <kbd className="kbd">H</kbd> 或 <kbd className="kbd">Esc</kbd> 关闭
        </div>
      </div>
    </div>
  );
}
