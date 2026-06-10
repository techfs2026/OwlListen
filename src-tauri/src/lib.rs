mod audio;
mod audiobook;
mod commands;
mod practice;
mod waveform;

use commands::AppState;

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_fs::init())
        .manage(AppState::new())
        .invoke_handler(tauri::generate_handler![
            commands::load_audio,
            commands::get_peaks,
            commands::save_labels,
            commands::load_labels,
            commands::get_temp_dir,
            commands::split_audio,
            commands::transcribe_segments,
            commands::transcribe_recording,
            commands::build_zip,
            commands::reveal_in_finder,
            commands::load_audiobook,
            commands::get_audiobook_progress,
            commands::save_audiobook_progress,
            commands::get_recent_audiobooks,
            commands::push_recent_audiobook,
            commands::remove_recent_audiobook,
            commands::get_audiobook_cover,
            commands::playback_open,
            commands::playback_play,
            commands::playback_pause,
            commands::playback_close,
            commands::playback_seek,
            commands::practice_open,
            commands::practice_play,
            commands::practice_pause,
            commands::practice_seek,
            commands::practice_play_segment,
            commands::practice_set_loop,
            commands::practice_set_speed,
            commands::practice_close,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
