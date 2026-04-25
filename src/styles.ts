// ── 全局设计 Token ────────────────────────────────────────────────────────────
// 所有颜色、间距、字体在此统一定义，组件直接引用

export const C = {
    paper: "#FAFAF7",
    paper2: "#F4F3EE",
    paper3: "#EEECEA",
    ink: "#1A2744",
    ink2: "#3D4F6E",
    ink3: "#8492AA",
    blue: "#1A4ED8",
    blueLt: "#E8EEFA",
    blueMid: "#5B7FEA",
    red: "#C0392B",
    redLt: "#FBEAEA",
    green: "#166534",
    greenLt: "#DCFCE7",
    amber: "#92400E",
    amberLt: "#FEF3C7",
    border: "rgba(26,39,68,0.09)",
    border2: "rgba(26,39,68,0.16)",
} as const;

export const FONT = {
    sans: "'DM Sans', system-ui, sans-serif",
    serif: "'DM Serif Display', Georgia, serif",
    mono: "'DM Mono', 'Fira Code', monospace",
} as const;

export const SHADOW = {
    sm: "0 1px 2px rgba(26,39,68,0.07)",
    md: "0 1px 3px rgba(26,39,68,0.07), 0 6px 20px rgba(26,39,68,0.06)",
    lg: "0 4px 24px rgba(26,39,68,0.10)",
} as const;

// 注入全局样式（Google Fonts + reset + scrollbar + animations）
export function injectGlobalStyles() {
    if (document.getElementById("__global-styles")) return;
    const el = document.createElement("style");
    el.id = "__global-styles";
    el.textContent = `
      @import url('https://fonts.googleapis.com/css2?family=DM+Serif+Display&family=DM+Mono:wght@400;500&family=DM+Sans:wght@300;400;500&display=swap');
  
      *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  
      body {
        background: ${C.paper2};
        color: ${C.ink};
        font-family: ${FONT.sans};
        overflow: hidden;
      }
  
      button { font-family: ${FONT.sans}; cursor: pointer; }
      button:disabled { opacity: 0.38; cursor: not-allowed; }
      input, textarea { font-family: ${FONT.sans}; }
      textarea { resize: none; }
  
      ::-webkit-scrollbar { width: 4px; height: 4px; }
      ::-webkit-scrollbar-track { background: transparent; }
      ::-webkit-scrollbar-thumb { background: ${C.border2}; border-radius: 2px; }
      ::-webkit-scrollbar-thumb:hover { background: ${C.ink3}; }
  
      @keyframes spin { to { transform: rotate(360deg); } }
      @keyframes fadeIn { from { opacity: 0; transform: translateY(6px); } to { opacity: 1; transform: none; } }
      @keyframes slideIn { from { opacity: 0; transform: translateX(-8px); } to { opacity: 1; transform: none; } }
    `;
    document.head.appendChild(el);
}