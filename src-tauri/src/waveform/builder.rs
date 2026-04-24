use rayon::prelude::*;
use super::peak::{Peak, WaveformSummary};
use crate::audio::DecodedAudio;

/// 根据音频时长自动选择 base_block_size
fn choose_base_block_size(duration_secs: f64) -> usize {
    if duration_secs <= 60.0 {
        16   // ← 从 64 改小
    } else if duration_secs <= 600.0 {
        32
    } else {
        64
    }
}

/// 构建完整的峰值金字塔
/// Level 0 用 rayon 并发，Level 1+ 串行（数据量小，无需并发）
pub fn build_summary(audio: &DecodedAudio) -> WaveformSummary {
    let duration = audio.duration_secs();
    let base_block  = choose_base_block_size(duration);
    let upper_block = 256usize;

    log::debug!(
        "Building summary: duration={:.2}s, base_block={}, upper_block={}",
        duration, base_block, upper_block
    );

    let level0 = build_level0_parallel(&audio.samples, base_block);
    log::debug!("Level 0: {} peaks", level0.len());

    let mut levels = vec![level0];

    // 逐层压缩直到收敛
    while levels.last().unwrap().len() > 1 {
        let prev = levels.last().unwrap();
        let next = build_upper_level(prev, upper_block);
        log::debug!("Level {}: {} peaks", levels.len(), next.len());
        levels.push(next);
    }

    WaveformSummary {
        levels,
        sample_rate: audio.sample_rate,
        total_samples: audio.samples.len() as u64,
        base_block_size: base_block,
        upper_block_size: upper_block,
    }
}

// ── 私有构建函数 ──────────────────────────────────────────────────────────────

/// Level 0：按 block_size 切分样本，rayon 并发计算每块的 [min, max]
fn build_level0_parallel(samples: &[f32], block_size: usize) -> Vec<Peak> {
    let total_peaks = samples.len().div_ceil(block_size);

    // rayon par_iter 自动分配线程，每个 chunk 独立计算，写入各自位置
    (0..total_peaks)
        .into_par_iter()
        .map(|i| {
            let start = i * block_size;
            let end   = (start + block_size).min(samples.len());
            let slice = &samples[start..end];

            let mut mn = f32::INFINITY;
            let mut mx = f32::NEG_INFINITY;
            for &s in slice {
                if s < mn { mn = s; }
                if s > mx { mx = s; }
            }
            Peak { min: mn, max: mx }
        })
        .collect()
}

/// 上层：把下层的 block_size 个 Peak 压缩为 1 个
fn build_upper_level(prev: &[Peak], block_size: usize) -> Vec<Peak> {
    let total = prev.len().div_ceil(block_size);
    (0..total)
        .map(|i| {
            let start = i * block_size;
            let end   = (start + block_size).min(prev.len());
            let slice = &prev[start..end];

            let mut mn = f32::INFINITY;
            let mut mx = f32::NEG_INFINITY;
            for p in slice {
                if p.min < mn { mn = p.min; }
                if p.max > mx { mx = p.max; }
            }
            Peak { min: mn, max: mx }
        })
        .collect()
}
