mod audio;
mod waveform;
mod commands;

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
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
