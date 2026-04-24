# LangListen Waveform Demo

Tauri 2.0 + Rust + React + WebGL2 的波形编辑器 Demo。

## 技术栈

| 层 | 技术 | 职责 |
|---|---|---|
| 音频解码 | Rust + ffmpeg-next | 解码任意格式到 f32 PCM |
| 峰值构建 | Rust + rayon | 并发构建多级金字塔 |
| IPC | Tauri commands | 二进制峰值传输 |
| 渲染 | WebGL2 | 波形线、标记、播放头 |
| 交互 | React hooks | 标记CRUD、视图控制 |

## 项目结构

```
src-tauri/src/
├── audio/
│   └── decoder.rs       # FFmpeg 解码 → f32 单声道
├── waveform/
│   ├── peak.rs          # Peak、WaveformSummary 数据结构
│   ├── builder.rs       # rayon 并发构建峰值金字塔
│   └── extractor.rs     # 层选择 + 混合提取
└── commands.rs          # Tauri IPC 命令

src/
├── types/waveform.ts    # 所有类型定义
├── utils/tauriApi.ts    # IPC 封装
├── hooks/
│   ├── useWaveform.ts   # 音频加载、视图控制
│   ├── useLabels.ts     # 标记 CRUD
│   └── useWebGL.ts      # WebGL2 渲染
└── components/waveform/
    ├── WaveformCanvas.tsx  # canvas + 鼠标事件
    ├── LabelList.tsx       # 标记列表
    ├── Toolbar.tsx         # 工具栏
    └── WaveformEditor.tsx  # 组合容器
```

## 构建

### 前置依赖

```bash
# macOS
brew install ffmpeg

# Ubuntu / Debian
sudo apt install libavcodec-dev libavformat-dev libavutil-dev libswresample-dev \
  libwebkit2gtk-4.1-dev libgtk-3-dev libayatana-appindicator3-dev librsvg2-dev

# Windows（推荐用 vcpkg）
vcpkg install ffmpeg
```

### 运行

```bash
npm install
npm run tauri dev
```

### 构建发布版

```bash
npm run tauri build
```

## 关键设计

**二进制峰值传输**：Rust 把 `Vec<Peak>` 转为 `Vec<u8>`，Tauri 传到前端后用
`new Float32Array(new Uint8Array(bytes).buffer)` 零拷贝转换，直接喂给 WebGL VBO。

**层混合**：缩放时在相邻两层之间线性插值，消除层切换的视觉跳变。

**播放头不走 IPC**：播放进度 `playhead` 是纯 React state，每帧直接传给 WebGL 渲染，
不经过 Rust，保证 60fps 不卡顿。

**标记纯前端**：`labels` 存在 React state，只有导出时才调一次 `save_labels` command。

## 集成到精听播放器

`WaveformEditor` 是独立组件，接受外部 `playhead` 和 `onSeek` props 即可接入播放器：

```tsx
<WaveformEditor
  externalPlayhead={playerCurrentTime}
  onSeek={(sec) => player.seek(sec)}
/>
```
