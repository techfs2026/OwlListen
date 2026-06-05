import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import reactRefresh from "eslint-plugin-react-refresh";
import tseslint from "typescript-eslint";

export default tseslint.config(
  // 构建产物 / 依赖 / Rust 目录不参与 lint
  { ignores: ["dist", "node_modules", "src-tauri"] },
  {
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    files: ["**/*.{ts,tsx}"],
    languageOptions: {
      ecmaVersion: 2022,
      globals: globals.browser,
    },
    plugins: {
      "react-hooks": reactHooks,
      "react-refresh": reactRefresh,
    },
    rules: {
      // TypeScript 自身已做未定义检查，关掉核心 no-undef 避免对全局对象误报
      "no-undef": "off",

      // 放宽几条对惯用法的误伤
      "no-empty": ["error", { allowEmptyCatch: true }], // catch {} 是 fire-and-forget 惯用法
      // 允许 cond && fn() / cond ? a() : b()（用 TS 版，它覆盖了核心同名规则）
      "@typescript-eslint/no-unused-expressions": [
        "error",
        { allowShortCircuit: true, allowTernary: true },
      ],

      // React Hooks 两条经典规则（v7 的 compiler 相关规则太激进，基线只取这两条）
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",

      // Vite HMR 友好：组件文件只导出组件
      "react-refresh/only-export-components": ["warn", { allowConstantExport: true }],

      // 以 _ 开头的参数/变量视为有意未用
      "@typescript-eslint/no-unused-vars": [
        "warn",
        {
          argsIgnorePattern: "^_",
          varsIgnorePattern: "^_",
          caughtErrorsIgnorePattern: "^_",
        },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
    },
  },
);
