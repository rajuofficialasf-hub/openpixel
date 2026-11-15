//! OpenPixel desktop application — Tauri 2 backend (Phase 8).
//!
//! The backend is a thin shell over `openpixel-core` and
//! `openpixel-jobs`: every command in [`commands`] calls the engine
//! directly, exactly like the CLI. No conversion logic lives in the
//! frontend and none is duplicated here.

pub mod commands;
pub mod logging;

pub use commands::AppState;

/// Build and run the Tauri application. The app data directory is
/// resolved in `setup` (it needs an `AppHandle`); the log directory
/// lives under it (`<app_data_dir>/logs/`).
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            use tauri::Manager;
            let log_dir = app
                .path()
                .app_data_dir()
                .map(|dir| dir.join("logs"))
                .unwrap_or_else(|_| std::env::temp_dir().join("openpixel-desktop-logs"));
            logging::append(&log_dir, "INFO", "OpenPixel desktop started (offline mode)");
            app.manage(AppState::new(log_dir));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::app_info,
            commands::get_capabilities,
            commands::get_image_info,
            commands::list_directory_images,
            commands::read_metadata,
            commands::list_frames,
            commands::convert_file,
            commands::process_file,
            commands::extract_frame,
            commands::start_batch,
            commands::batch_progress,
            commands::batch_jobs,
            commands::batch_results,
            commands::batch_pause,
            commands::batch_resume,
            commands::batch_cancel_all,
            commands::batch_cancel,
            commands::batch_retry_failed,
            commands::read_logs,
        ])
        .run(tauri::generate_context!())
        .expect("error while running OpenPixel desktop");
}
