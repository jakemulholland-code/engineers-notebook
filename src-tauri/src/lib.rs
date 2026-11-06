mod commands;

use commands::{ai, assets, export, fs, keychain, watch};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let mut builder = tauri::Builder::default();

    #[cfg(desktop)]
    {
        use tauri::Manager;
        builder = builder
            // Must be registered first: a second launch focuses the open window instead.
            .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
                if let Some(w) = app.get_webview_window("main") {
                    let _ = w.unminimize();
                    let _ = w.show();
                    let _ = w.set_focus();
                }
            }))
            // Remembers window size, position and maximised state.
            .plugin(tauri_plugin_window_state::Builder::default().build())
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
            .plugin(tauri_plugin_autostart::init(
                tauri_plugin_autostart::MacosLauncher::LaunchAgent,
                None,
            ));
    }

    builder
        .manage(ai::AiState::default())
        .manage(watch::WatchState::default())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            fs::app_config_path,
            fs::read_app_config,
            fs::write_app_config,
            fs::read_app_file,
            fs::write_app_file,
            fs::path_exists,
            fs::prepare_client_folder,
            fs::list_page_files,
            fs::read_text_file,
            fs::write_text_atomic,
            fs::rename_file,
            fs::open_in_explorer,
            fs::trash_page_file,
            fs::update_notebook_meta,
            watch::watch_notes_folder,
            watch::unwatch_notes_folder,
            fs::open_app_dir,
            fs::backup_config,
            assets::save_asset,
            assets::read_asset,
            keychain::key_status,
            keychain::save_key,
            keychain::remove_key,
            ai::ai_list_models,
            ai::ai_complete,
            ai::ai_cancel,
            export::export_prepare_dir,
            export::export_write,
            export::export_write_text,
            export::export_copy_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Engineer's Notebook");
}
