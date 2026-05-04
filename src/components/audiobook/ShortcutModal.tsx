import "./ShortcutModal.scss";

const SHORTCUT_GROUPS: { group: string; items: { key: string; label: string }[] }[] = [
  {
    group: "播放",
    items: [
      { key: "P", label: "播放 / 暂停" },
      { key: "J", label: "上一章节" },
      { key: "L", label: "下一章节" },
    ],
  },
  {
    group: "界面",
    items: [{ key: "H", label: "显示 / 隐藏帮助" }],
  },
];

interface ShortcutModalProps { onClose: () => void; }

export function ShortcutModal({ onClose }: ShortcutModalProps) {
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal-card shortcut-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-card__title">键盘快捷键</div>

        <div className="shortcut-modal__cols">
          {SHORTCUT_GROUPS.map((group) => (
            <div key={group.group} className="shortcut-modal__group">
              <div className="shortcut-modal__group-name">{group.group}</div>
              {group.items.map(({ key, label }) => (
                <div key={key} className="shortcut-modal__row">
                  <kbd className="kbd">{key}</kbd>
                  <span className="shortcut-modal__label">{label}</span>
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