# LangListen

## 动机

```
工欲善其事，
必先利其器。
```

LangListen 是一个基于 Tauri v2.0 的英语精听应用。

设计核心原则：

+ 离线。离线数据、离线练习
+ 专注。UI 简洁美观、沉浸式体验
+ 成长。重复但不死板、刻意练习

目标：

英语听力练习，听得到的进步！

## 工作流

LangListen 采用「**标注 → 数据包 → 精听**」两阶段工作流，并附带**有声书**模式用于泛听积累：

1. **标注模式**：导入一段长音频（一集播客 / 一段演讲 / 一段电影对白），在波形上划出值得反复听写的片段，给每段写备注。导出时本地用 Whisper 自动转写，打包成一个 ZIP 数据包。
2. **精听模式**：导入数据包，逐片段听写，实时与转写原文做 Diff 对照，标记完成或需要重听。
3. **有声书模式**：导入 M4B 有声书文件，按章节浏览，进度自动保存，适合泛听积累。

数据包是自包含的 ZIP，可以备份、分享、跨设备同步。所有转写都在本地完成，不依赖任何云服务。

## 功能

### 标注模式（Annotate）

- **波形可视化**：基于金字塔分层的峰值索引，缩放/平移流畅；根据采样密度自适应在 envelope（包络）/ polyline（折线）/ stem（茎线）三种渲染模式间切换
- **音频格式**：MP3（FFmpeg 解码），支持拖拽打开
- **片段标注**：在波形上拖拽即可划出区间，每段可独立填写备注
- **标记持久化**：标记列表可保存为 `.txt`（TSV：`start\tend\ttext`），随时载入继续
- **导出数据包**：FFmpeg 切割 → Whisper 本地转写 → 打包为 ZIP

### 精听模式（Listen）

- **ZIP 导入**：拖拽或选择 ZIP 数据包，前端用 JSZip 解压，音频转 blob URL
- **片段侧边栏**：显示所有片段及其完成状态（待办 / 已完成 / 重听）
- **听写面板**：循环播放当前片段，输入听到的内容
- **Diff 对照**：随时切换显示原文 / 与原文逐词 Diff，错漏一目了然
- **状态标记**：D 标记完成并自动跳下一段，F 标记重听
- **全键盘操作**：从播放到导航到标记，整个练习流程可以不离开键盘

### 有声书模式（Audiobook）

- **音频格式**：M4B，支持拖拽打开
- **章节解析**：FFmpeg 读取内嵌章节信息，自动列出章节列表；无章节信息时整本书作为单章处理
- **章节侧边栏**：显示所有章节、起始时间与时长，当前章节高亮并显示实时进度条；侧边栏可折叠
- **进度恢复**：每 5 秒自动保存章节索引与章节内偏移，下次打开自动跳回
- **最近打开**：记录最近 10 本书，顶栏下拉一键切换，无需重新选择文件
- **播放控制**：可拖拽进度条、变速播放（0.5×–1.75×）、上 / 下一章跳转
- **封面占位**：无嵌入封面时，按书名生成渐变色占位图

### 键盘快捷键

| 模式 | 键 | 作用 |
|------|----|----|
| 标注 | `P` | 播放 / 暂停 |
| 精听 | `P` | 播放 / 暂停 |
| 精听 | `R` | 从头重播 |
| 精听 | `Enter` | 切换对照原文 / Diff |
| 精听 | `I` | 进入输入模式（聚焦 textarea） |
| 精听 | `Esc` | 退出输入模式 |
| 精听 | `J` / `L` | 上一段 / 下一段 |
| 精听 | `D` | 标记完成并跳下一段 |
| 精听 | `F` | 标记重听 |
| 精听 | `Z` | 切换全屏 |
| 精听 | `H` | 显示 / 隐藏帮助 |
| 有声书 | `P` | 播放 / 暂停 |
| 有声书 | `[` | 上一章 |
| 有声书 | `]` | 下一章 |

## 数据包格式

ZIP 内部结构：

```
listening_pack.zip
├── metadata.json
└── segments/
    ├── 0000.mp3
    ├── 0001.mp3
    └── ...
```

`metadata.json`：

```json
{
  "version": 1,
  "segments": [
    {
      "index": 0,
      "audio": "segments/0000.mp3",
      "start": 1.234,
      "end": 4.567,
      "text": "Whisper 转写文本",
      "label": "用户备注"
    }
  ]
}
```

切片均为 16 kHz 单声道 MP3（64 kbps），与 Whisper 输入格式一致，体积小、便于分享。

## 技术栈

- **前端**：React 18 + TypeScript + Vite，无 UI 库（原生 `style` + 共享 Primitives 组件）
- **桌面壳**：Tauri v2.0（`plugin-dialog`, `plugin-fs`, `protocol-asset`）
- **音频解码 / 编码**：[`ffmpeg-next`](https://crates.io/crates/ffmpeg-next)（libmp3lame）
- **本地转写**：[`whisper-rs`](https://crates.io/crates/whisper-rs)（whisper.cpp 绑定）
- **波形渲染**：金字塔峰值索引 + Canvas / WebGL（`useWebGL` hook）
- **有声书播放**：Web Audio API（`AudioContext` + `AudioBufferSourceNode`），整本书一次解码缓存
- **打包**：`zip` crate
- **并发 / SIMD**：`rayon`, `wide`

## 开发与构建

依赖：Node.js 18+、Rust（stable）、FFmpeg（开发库）。

```bash
# 安装前端依赖
npm install

# 开发模式（启动 Tauri + Vite）
npm run tauri dev

# 生产构建
npm run tauri build
```

### Whisper 模型

转写功能需要本地 GGML 模型，放在仓库根目录的 `whisper-models/`：

| 模型 | 文件名 | 大小 | 推荐场景 |
|------|--------|------|----------|
| base.en | `ggml-base.en.bin` | ~140 MB | 默认，速度优先 |
| small.en | `ggml-small.en.bin` | ~470 MB | 平衡 |
| medium.en | `ggml-medium.en.bin` | ~1.5 GB | 质量优先 |

模型可从 [whisper.cpp 仓库](https://huggingface.co/ggerganov/whisper.cpp/tree/main) 下载，置入 `whisper-models/` 即可。当前默认使用 `base.en`。