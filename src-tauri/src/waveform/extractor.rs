use super::peak::{ChannelPyramid, Peak, WaveformSummary};
use super::view::{ChannelRenderData, RenderData, RenderMode, ViewRange};
use crate::audio::RawSamples;

/// 主入口:根据视图参数提取所有声道的渲染数据
pub fn extract(summary: &WaveformSummary, view: &ViewRange) -> RenderData {
    if !summary.is_valid() || view.pixel_width == 0 || view.duration() <= 0.0 {
        return empty_render(summary, view, RenderMode::Envelope);
    }

    let spp = view.samples_per_pixel(summary.sample_rate);

    // 模式选择关键:Envelope 的下限是 base_block_size
    //
    // Envelope 模式从金字塔 Level 0 取数据,每个 Peak 已经压缩了 base_block_size 个样本。
    // 如果 spp < base_block_size,意味着每个 pixel 不到 1 个 Peak,多个相邻 pixel 会
    // 共享同一个 Peak 的 min/max,视觉上呈现为水平台阶("马赛克")。
    //
    // 所以 spp 一旦小于 base_block_size,就必须切到 Polyline,从原始样本读取真实细节。
    let envelope_min_spp = summary.base_block_size as f64;
    let mode = if spp >= envelope_min_spp {
        RenderMode::Envelope
    } else if spp >= 1.0 {
        RenderMode::Polyline
    } else {
        RenderMode::Stem
    };

    let channels: Vec<ChannelRenderData> = (0..summary.channel_count())
        .map(|ch| match mode {
            RenderMode::Envelope => {
                ChannelRenderData::Envelope(extract_envelope(summary, ch, view, spp))
            }
            RenderMode::Polyline => {
                ChannelRenderData::Polyline(extract_polyline(&summary.raw, ch, view))
            }
            RenderMode::Stem => ChannelRenderData::Stem(extract_polyline(&summary.raw, ch, view)),
        })
        .collect();

    RenderData {
        mode,
        channels,
        view: *view,
    }
}

fn empty_render(summary: &WaveformSummary, view: &ViewRange, mode: RenderMode) -> RenderData {
    let channels = (0..summary.channel_count().max(1))
        .map(|_| match mode {
            RenderMode::Envelope => {
                ChannelRenderData::Envelope(vec![Peak::zero(); view.pixel_width])
            }
            RenderMode::Polyline => ChannelRenderData::Polyline(Vec::new()),
            RenderMode::Stem => ChannelRenderData::Stem(Vec::new()),
        })
        .collect();
    RenderData {
        mode,
        channels,
        view: *view,
    }
}

// ── Envelope 模式 ────────────────────────────────────────────────────────────

/// 包络模式:从金字塔取 min/max/rms
/// 选最接近 spp 的层;若位于两层之间,做 lerp 平滑过渡
fn extract_envelope(
    summary: &WaveformSummary,
    channel: usize,
    view: &ViewRange,
    spp: f64,
) -> Vec<Peak> {
    let pyramid = &summary.channels[channel];
    if pyramid.levels.is_empty() {
        return vec![Peak::zero(); view.pixel_width];
    }

    // 选 spe ≤ spp 的最大层(即"细于或等于目标的最近层")
    // 关键:宁可用更细的层,在 extract_from_level 内部做 min/max 聚合,
    //       也不要选粗层导致单个 Peak 横跨多个 pixel(产生"水平台阶")
    //
    // 反例(以前的"绝对差最近"策略):
    //   spp=300, Level 0 spe=64, Level 1 spe=512
    //   |300-64|=236, |300-512|=212 → 选 Level 1
    //   结果:Level 1 每个 Peak 横跨 ~1.7 个 pixel,相邻 pixel 共享同一 Peak
    //         视觉上呈现宽水平台阶,即所谓"马赛克"
    //
    // 新策略:spp=300 选 Level 0(spe=64 ≤ 300),内部把 ~5 个 Level 0 Peak
    //         聚合到 1 个 pixel,得到该 pixel 真实的 min/max/rms
    let chosen = (0..pyramid.level_count())
        .filter(|&l| (summary.samples_per_entry(l) as f64) <= spp)
        .last()
        .unwrap_or(0);

    log::trace!(
        "extract_envelope: spp={:.1}, chosen=Level {} (spe={})",
        spp,
        chosen,
        summary.samples_per_entry(chosen)
    );

    // 直接用选定的层。不再做层间 lerp:
    // - 既然选了 spe ≤ spp,extract_from_level 内部会做正确的 min/max 聚合
    // - lerp 在层之间引入的"中间值"反而是伪数据,会让台阶感更明显
    extract_from_level(pyramid, chosen, summary, view)
}

/// 从指定层提取 pixel_width 个 Peak
fn extract_from_level(
    pyramid: &ChannelPyramid,
    level: usize,
    summary: &WaveformSummary,
    view: &ViewRange,
) -> Vec<Peak> {
    let src = &pyramid.levels[level];
    if src.is_empty() {
        return vec![Peak::zero(); view.pixel_width];
    }

    let spe = summary.samples_per_entry(level) as f64;
    let sr = summary.sample_rate as f64;

    // 视图边界对应到该层的 entry 索引(浮点)
    let start_f = (view.start_sec * sr) / spe;
    let end_f = (view.end_sec * sr) / spe;

    let max_idx = (src.len() - 1) as f64;
    let start_f = start_f.clamp(0.0, max_idx);
    let end_f = end_f.clamp(0.0, max_idx);

    let width = view.pixel_width as f64;
    let range = end_f - start_f;

    (0..view.pixel_width)
        .map(|i| {
            let left = start_f + (i as f64 / width) * range;
            let right = start_f + ((i + 1) as f64 / width) * range;

            // 用 floor + (right - eps).floor() 防止区间扩张
            let l = (left.floor() as usize).min(src.len() - 1);
            let r = ((right - 1e-9).floor() as usize).min(src.len() - 1);

            if l >= r {
                src[l]
            } else {
                let mut mn = f32::INFINITY;
                let mut mx = f32::NEG_INFINITY;
                let mut sum_sq = 0.0_f32;
                let count = (r - l + 1) as f32;
                for j in l..=r {
                    let p = src[j];
                    if p.min < mn {
                        mn = p.min;
                    }
                    if p.max > mx {
                        mx = p.max;
                    }
                    sum_sq += p.rms * p.rms;
                }
                Peak {
                    min: mn,
                    max: mx,
                    rms: (sum_sq / count).sqrt(),
                }
            }
        })
        .collect()
}

// ── Polyline / Stem 模式 ─────────────────────────────────────────────────────

/// 折线模式每 pixel 最多保留的点数
/// 4 个点足以表达局部波形细节(2 上 2 下),再多人眼也看不出区别,
/// 但数据量会爆炸(IPC 序列化 + GPU 上传都吃不消)
const MAX_POINTS_PER_PIXEL: usize = 4;

/// 从原始样本构建折线顶点序列
/// 返回 (x_pixel, sample_value) 列表,x_pixel 已映射到 [0, pixel_width)
///
/// 关键性能保护:**下采样到至多 pixel_width × MAX_POINTS_PER_PIXEL 个点**
///
/// 触发场景:Polyline 模式下 spp 接近 base_block_size(比如 60),
///           pixel_width=3024 对应 ~18 万原始样本,IPC + 渲染合计可达 100ms+,
///           滚动卡顿。下采样到 ~12000 点后,IPC < 5ms,渲染流畅
///
/// 视觉无损:相邻样本被均匀抽样,折线整体形状保持,人眼无法分辨差异
fn extract_polyline(raw: &RawSamples, channel: usize, view: &ViewRange) -> Vec<(f32, f32)> {
    let samples = match raw.channels.get(channel) {
        Some(s) if !s.is_empty() => s,
        _ => return Vec::new(),
    };

    let sr = raw.sample_rate as f64;
    let total = samples.len();

    let start_sample_f = view.start_sec * sr;
    let end_sample_f = view.end_sec * sr;

    let s0 = (start_sample_f.floor() as i64).max(0) as usize;
    let s1_inclusive = ((end_sample_f.ceil() as i64).max(0) as usize).min(total.saturating_sub(1));

    if s0 > s1_inclusive {
        return Vec::new();
    }

    let pixel_per_sample = view.pixel_width as f64 / (end_sample_f - start_sample_f);
    let raw_count = s1_inclusive - s0 + 1;
    let max_points = view.pixel_width * MAX_POINTS_PER_PIXEL;

    // 决定步长:原始样本多于上限时,均匀跳点
    // 步长用整数:简单稳定,且可保证输出长度严格 ≤ max_points
    let stride = if raw_count > max_points {
        raw_count.div_ceil(max_points).max(1)
    } else {
        1
    };

    let cap = raw_count.div_ceil(stride);
    let mut out: Vec<(f32, f32)> = Vec::with_capacity(cap);

    let mut i = s0;
    while i <= s1_inclusive {
        let x = ((i as f64 - start_sample_f) * pixel_per_sample) as f32;
        let y = samples[i];
        out.push((x, y));
        i += stride;
    }

    // 保证最后一个样本被包括(如果跳点导致漏掉),让折线在视口右边缘接得住
    if out.last().map(|&(x, _)| x).unwrap_or(f32::NEG_INFINITY)
        < ((s1_inclusive as f64 - start_sample_f) * pixel_per_sample) as f32
    {
        let x = ((s1_inclusive as f64 - start_sample_f) * pixel_per_sample) as f32;
        out.push((x, samples[s1_inclusive]));
    }

    out
}
