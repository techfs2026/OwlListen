// 生产环境隐藏控制台窗口（Windows）
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    langlisten_waveform_lib::run();
}
