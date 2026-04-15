mod browser;
mod commands;

use browser::BrowserState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_http::init())
        .plugin(tauri_plugin_shell::init())
        .manage(BrowserState::new())
        .invoke_handler(tauri::generate_handler![
            commands::navigate,
            commands::new_tab,
            commands::close_tab,
            commands::activate_tab,
            commands::get_tabs,
            commands::get_active_tab_id,
            commands::go_back,
            commands::go_forward,
            commands::reload,
            commands::set_tab_meta,
            commands::fetch_intel,
            commands::open_devtools,
            commands::window_minimize,
            commands::window_toggle_maximize,
            commands::window_close,
        ])
        .setup(|_app| {
            #[cfg(debug_assertions)]
            {
                use tauri::Manager;
                if let Some(win) = _app.get_webview_window("main") {
                    win.open_devtools();
                }
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running Monitor Browser");
}
