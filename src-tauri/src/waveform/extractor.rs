use super::peak::{Peak, WaveformSummary};

/// 当前视图参数
pub struct ViewRange {
    pub start_sec: f64,
    pub end_sec: f64,
    pub pixel_width: usize,
}

impl ViewRange {
    pub fn duration(&self) -> f64 {
        self.end_sec - self.start_sec
    }

    pub fn samples_per_pixel(&self, sample_rate: u32) -> f64 {
        self.duration() * sample_rate as f64 / self.pixel_width as f64
    }
}

/// 从金字塔中提取适合当前视图的峰值序列
/// 自动选层 + 相邻层线性混合，保证缩放平滑
pub fn extract_peaks(summary: &WaveformSummary, view: &ViewRange) -> Vec<Peak> {
    if !summary.is_valid() || view.pixel_width == 0 || view.duration() <= 0.0 {
        return vec![Peak::default(); view.pixel_width];
    }

    let spp = view.samples_per_pixel(summary.sample_rate);

    // 选层：找最接近 spp 的层
    let chosen = (0..summary.level_count())
        .min_by(|&a, &b| {
            let da = (summary.samples_per_entry(a) as f64 - spp).abs();
            let db = (summary.samples_per_entry(b) as f64 - spp).abs();
            da.partial_cmp(&db).unwrap()
        })
        .unwrap();

    // ✅ 改进：只在必要时做“包络合并”，不做 lerp
    if chosen > 0 {
        let spe_lo = summary.samples_per_entry(chosen - 1) as f64;
        let spe_hi = summary.samples_per_entry(chosen) as f64;

        let t = ((spp - spe_lo) / (spe_hi - spe_lo)).clamp(0.0, 1.0);

        // 只在过渡区间做处理
        if t > 0.05 && t < 0.95 {
            let lo = extract_from_level(summary, chosen - 1, view);
            let hi = extract_from_level(summary, chosen, view);

            // ✅ 关键修复：用 min/max 合并，而不是 lerp
            return lo
                .into_iter()
                .zip(hi)
                .map(|(a, b)| Peak {
                    min: a.min.min(b.min),
                    max: a.max.max(b.max),
                })
                .collect();
        }
    }

    // 默认：直接用选中层
    extract_from_level(summary, chosen, view)
}

// ── 私有辅助 ─────────────────────────────────────────────────────────────────

fn extract_from_level(summary: &WaveformSummary, level: usize, view: &ViewRange) -> Vec<Peak> {
    let src = &summary.levels[level];
    let spe = summary.samples_per_entry(level) as f64;
    let sr = summary.sample_rate as f64;

    if src.is_empty() {
        return vec![Peak::default(); view.pixel_width];
    }

    let start_f = (view.start_sec * sr) / spe;
    let end_f = (view.end_sec * sr) / spe;

    let max_idx = (src.len() - 1) as f64;

    let start_f = start_f.clamp(0.0, max_idx);
    let end_f = end_f.clamp(0.0, max_idx);

    let width = view.pixel_width as f64;
    let range = end_f - start_f;

    (0..view.pixel_width)
        .map(|i| {
            // 当前 pixel 对应的连续区间
            let left = start_f + (i as f64 / width) * range;
            let right = start_f + ((i + 1) as f64 / width) * range;

            // ⚠️ 关键：稳定区间映射（避免 ceil 带来的扩张）
            let l = left.floor() as usize;
            let r = (right - 1e-9).floor() as usize;

            let l = l.min(src.len() - 1);
            let r = r.min(src.len() - 1);

            if l >= r {
                // ✅ 单点或极窄区间：直接返回该点
                src[l]
            } else {
                // ✅ 区间 min/max 聚合（核心）
                let mut mn = f32::INFINITY;
                let mut mx = f32::NEG_INFINITY;

                for j in l..=r {
                    let p = src[j];
                    if p.min < mn {
                        mn = p.min;
                    }
                    if p.max > mx {
                        mx = p.max;
                    }
                }

                Peak { min: mn, max: mx }
            }
        })
        .collect()
}

#[inline]
fn lerp(a: f32, b: f32, t: f32) -> f32 {
    a + (b - a) * t
}
