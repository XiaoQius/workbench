mod commands;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_sql::Builder::default().build())
        .invoke_handler(tauri::generate_handler![
            commands::disk::disk_space,
            commands::port::port_usage,
            commands::project::scan_projects,
            commands::system::export_backup,
            commands::system::list_backups,
            commands::system::read_backup,
            commands::ai::llm_status,
            commands::ai::llm_chat,
            commands::agent::scan_agents,
            commands::git::git_status,
            commands::asset::scan_assets,
            commands::health::health_check,
            commands::proxy::proxy_detect,
            commands::port::port_probe,
            commands::wsl::wsl_status,
            commands::schtasks::schtasks_list,
            commands::agent::agent_workflow,
            commands::system::backup_verify,
            commands::system::export_backup_to,
            commands::dev::open_path,
            commands::dev::launch_app,
            commands::dev::git_log,
            commands::dev::code_stats,
            commands::dev::env_list,
            commands::dev::repo_health,
            commands::dev::deps_check,
            commands::installed::list_installed_apps,
            commands::installed::resolve_shortcut,
            commands::update::check_update,
            commands::update::download_update,
            commands::update::install_update,
            commands::git::git_remote_info,
            commands::git::git_init_repo,
            commands::git::git_commit_all,
            commands::git::git_gh_upload
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
