// Prevents additional console window on Windows in release, DO NOT REMOVE!!
#![cfg_attr(not(debug_assertions), windows_subsystem = "windows")]

fn main() {
    if code_light_lib::run_statusline_proxy_from_args() {
        return;
    }
    code_light_lib::run()
}
