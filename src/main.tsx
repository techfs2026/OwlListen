import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

const style = document.createElement("style");
style.textContent = `
  *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: #F8FAFF; color: #1E293B; font-family: system-ui, -apple-system, sans-serif; overflow: hidden; }
  button:disabled { opacity: 0.4; cursor: not-allowed; }
  button:not(:disabled):hover { filter: brightness(0.94); }
  input:focus { outline: 2px solid #93C5FD; outline-offset: 0; border-color: #3B82F6 !important; }
  ::-webkit-scrollbar { width: 5px; height: 5px; }
  ::-webkit-scrollbar-track { background: #F1F5F9; }
  ::-webkit-scrollbar-thumb { background: #CBD5E1; border-radius: 3px; }
  ::-webkit-scrollbar-thumb:hover { background: #94A3B8; }
  @keyframes spin { to { transform: rotate(360deg); } }
`;
document.head.appendChild(style);

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);