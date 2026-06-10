//! 端到端验证：加载一个音频文件，走 BufferSource + OutputSink 实际播放出声。
//!
//! 用法：
//!   cargo run -p audioplayer --example play -- <路径> [秒数=8] [start end mode]
//!     mode = seg  → 一次性播放区间 [start,end]，到 end 停止
//!     mode = loop → AB 循环 [start,end]
//!   例：... -- a.mp3 8 2 4 loop   # 循环 2~4s
//!
//! 这条路径不依赖 Tauri，纯粹验证「整段解码进内存 → cpal 输出」能正常出声。

use audioplayer::{BufferSource, OutputSink};
use cpal::traits::{DeviceTrait, HostTrait};
use std::sync::Arc;
use std::time::Duration;

fn main() -> anyhow::Result<()> {
    let mut args = std::env::args().skip(1);
    let path = args.next().expect("用法: --example play -- <路径> [秒数]");
    let play_secs: f64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(8.0);

    println!("加载: {path}");
    let source = Arc::new(BufferSource::load_from_file(&path)?);
    println!(
        "解码完成: 采样率={} 时长={:.2}s",
        source.sample_rate(),
        source.duration_secs(),
    );

    let host = cpal::default_host();
    let device = host.default_output_device().expect("无输出设备");
    let supported = device.default_output_config()?;
    let config = cpal::StreamConfig {
        channels: supported.channels(),
        sample_rate: source.sample_rate(),
        buffer_size: cpal::BufferSize::Default,
    };
    println!(
        "输出: 声道={} 采样率={}",
        config.channels, config.sample_rate,
    );

    // 可选：区间 / 循环
    let start: Option<f64> = args.next().and_then(|s| s.parse().ok());
    let end: Option<f64> = args.next().and_then(|s| s.parse().ok());
    let mode = args.next();
    // 可选参数 speed=N 变速（先设，再设区间/循环，验证边界按新速率换算）
    if let Some(speed) = std::env::args().find_map(|a| a.strip_prefix("speed=").map(str::to_owned))
    {
        if let Ok(sp) = speed.parse::<f32>() {
            source.set_speed(sp)?;
            println!("变速 = {sp}×");
        }
    }

    if let (Some(s), Some(e)) = (start, end) {
        match mode.as_deref() {
            Some("loop") => {
                source.set_loop(Some((s, e)));
                source.seek_to_secs(s);
                println!("AB 循环 {s}~{e}s");
            }
            _ => {
                source.play_segment(s, e);
                println!("区间播放 {s}~{e}s");
            }
        }
    }

    let sink = OutputSink::new(&device, &config, source.clone())?;
    sink.play()?;
    println!("▶ 播放 {play_secs:.0}s …");

    // 边播边打印进度，验证 position 在推进
    let steps = (play_secs / 0.5).ceil() as u32;
    for _ in 0..steps {
        std::thread::sleep(Duration::from_millis(500));
        println!("  pos = {:.2}s", source.position_secs());
        if source.is_finished() {
            break;
        }
    }

    sink.pause()?;
    println!("⏸ 停止。");
    Ok(())
}
