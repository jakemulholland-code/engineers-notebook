mod commands;

use commands::{assets, fs};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
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
            assets::save_asset,
            assets::read_asset,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Engineer's Notebook");
}
