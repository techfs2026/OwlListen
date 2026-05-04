import React from "react";
import { Spinner } from "./icons";
import "./LoadingModal.scss";

interface LoadingModalProps {
  /** 主提示，例如 "正在打开有声书…" */
  title?: string;
  /** 副提示，例如书名 */
  subtitle?: string;
}

export function LoadingModal({
  title = "加载中",
  subtitle,
}: LoadingModalProps) {
  return (
    <div className="modal-overlay loading-modal__overlay">
      <div className="loading-modal">
        <div className="loading-modal__spinner">
          <Spinner size={36} />
        </div>
        <div className="loading-modal__title">{title}</div>
        {subtitle && <div className="loading-modal__subtitle">{subtitle}</div>}
      </div>
    </div>
  );
}