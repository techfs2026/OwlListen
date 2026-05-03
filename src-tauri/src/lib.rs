mod audio;
mod commands;
mod waveform;
mod audiobook;

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
            commands::build_zip,
            commands::reveal_in_finder,
            commands::load_audiobook,
            commands::get_audiobook_progress,
            commands::save_audiobook_progress,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
