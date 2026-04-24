/// 一段样本区间内的 [min, max]，各占 f32
#[derive(Clone, Copy, Debug, Default)]
#[repr(C)]  // 保证内存布局：[min: f32, max: f32]，方便直接转 &[u8]
pub struct Peak {
    pub min: f32,
    pub max: f32,
}

/// 多级峰值金字塔
/// levels[0] 最细（baseBlockSize 个样本 → 1 个 Peak）
/// levels[n] 最粗（收敛到 1 个 Peak 时停止）
pub struct WaveformSummary {
    pub levels: Vec<Vec<Peak>>,
    pub sample_rate: u32,
    pub total_samples: u64,
    pub base_block_size: usize,
    pub upper_block_size: usize,
}

impl WaveformSummary {
    pub fn duration_secs(&self) -> f64 {
        self.total_samples as f64 / self.sample_rate as f64
    }

    pub fn is_valid(&self) -> bool {
        !self.levels.is_empty() && self.total_samples > 0
    }

    /// 第 level 层每个 Peak 对应的样本数
    pub fn samples_per_entry(&self, level: usize) -> u64 {
        let mut count = self.base_block_size as u64;
        for _ in 0..level {
            count *= self.upper_block_size as u64;
        }
        count
    }

    /// 层数
    pub fn level_count(&self) -> usize {
        self.levels.len()
    }
}
