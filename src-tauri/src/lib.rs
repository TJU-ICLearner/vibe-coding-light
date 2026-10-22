mod pet_commands;
mod pet_image;
mod pet_store;
#[cfg(target_os = "macos")]
mod pet_vision;
mod ui_copy;
mod ui_locale;

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    image::Image,
    menu::{
        CheckMenuItem, CheckMenuItemBuilder, MenuBuilder, MenuItem, MenuItemBuilder, Submenu,
        SubmenuBuilder,
    },
    tray::TrayIconBuilder,
    Emitter, Manager,
};
#[cfg(target_os = "macos")]
use tauri::{WebviewUrl, WebviewWindowBuilder};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, ShortcutState};

#[derive(Clone)]
struct TrayUi {
    toggle_pet: MenuItem<tauri::Wry>,
    whip: MenuItem<tauri::Wry>,
    customize_pet: Option<MenuItem<tauri::Wry>>,
    setup_claude: MenuItem<tauri::Wry>,
    setup_codex: MenuItem<tauri::Wry>,
    language: Submenu<tauri::Wry>,
    chinese: CheckMenuItem<tauri::Wry>,
    english: CheckMenuItem<tauri::Wry>,
    quit: MenuItem<tauri::Wry>,
    pet_visible: bool,
    claude_feedback: ui_copy::HookFeedback,
    codex_feedback: ui_copy::HookFeedback,
}

fn refresh_tray_ui(app: &tauri::AppHandle, locale: ui_locale::AppLocale) {
    let Some(ui) = app.try_state::<Arc<Mutex<TrayUi>>>() else {
        return;
    };
    let ui = ui.lock().unwrap().clone();
    let labels = ui_copy::menu_labels(
        locale,
        ui.pet_visible,
        &ui.claude_feedback,
        &ui.codex_feedback,
    );
    let _ = ui.toggle_pet.set_text(labels.toggle_pet);
    let _ = ui.whip.set_text(labels.whip);
    if let Some(item) = &ui.customize_pet {
        let _ = item.set_text(labels.customize_pet);
    }
    let _ = ui.setup_claude.set_text(labels.claude_hooks);
    let _ = ui.setup_codex.set_text(labels.codex_hooks);
    let _ = ui.language.set_text(labels.language);
    let _ = ui.chinese.set_text(labels.chinese);
    let _ = ui.english.set_text(labels.english);
    let _ = ui.chinese.set_checked(locale == ui_locale::AppLocale::ZhCn);
    let _ = ui.english.set_checked(locale == ui_locale::AppLocale::En);
    let _ = ui.quit.set_text(labels.quit);
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_title(ui_copy::settings_title(locale));
    }
    if let Some(state) = app.try_state::<Arc<Mutex<AppState>>>() {
        with_status_snapshot(&state, |current, message, timestamp, count| {
            if let Some(tray) = app.tray_by_id("main") {
                let _ = tray.set_tooltip(Some(&ui_copy::status_text(
                    locale, current, &message, timestamp, count,
                )));
            }
        });
    }
}

fn current_locale(app: &tauri::AppHandle) -> ui_locale::AppLocale {
    app.state::<Arc<Mutex<ui_locale::UiLocaleStore>>>()
        .lock()
        .unwrap()
        .get()
}

#[tauri::command]
fn get_app_locale(app: tauri::AppHandle) -> ui_locale::AppLocale {
    current_locale(&app)
}

fn set_app_locale_impl(
    app: &tauri::AppHandle,
    requested: ui_locale::AppLocale,
) -> Result<ui_locale::AppLocale, String> {
    let store = app.state::<Arc<Mutex<ui_locale::UiLocaleStore>>>();
    let updated = {
        let mut store = store.lock().unwrap();
        change_locale(&mut store, requested, |_| {})?
    };
    refresh_tray_ui(app, updated);
    let _ = app.emit("locale-changed", updated);
    Ok(updated)
}

#[tauri::command]
fn set_app_locale(
    app: tauri::AppHandle,
    locale: ui_locale::AppLocale,
) -> Result<ui_locale::AppLocale, String> {
    set_app_locale_impl(&app, locale)
}

fn change_locale(
    store: &mut ui_locale::UiLocaleStore,
    requested: ui_locale::AppLocale,
    publish: impl FnOnce(ui_locale::AppLocale),
) -> Result<ui_locale::AppLocale, String> {
    store.set(requested)?;
    publish(requested);
    Ok(requested)
}

const POLL_INTERVAL: Duration = Duration::from_secs(1);
const BLINK_INTERVAL: Duration = Duration::from_millis(500);
const SESSION_STALE_SECS: u64 = 300;
const SESSION_EXPIRE_SECS: u64 = 86_400;
const COMPLETED_DISPLAY_SECS: u64 = 10;

#[derive(Debug, Clone, Copy, PartialEq, Eq, PartialOrd, Ord, Deserialize, Serialize)]
enum State {
    Idle = 0,
    Unknown = 1,
    Completed = 2,
    Working = 3,
    Waiting = 4,
    Error = 5,
}

impl State {
    fn from_str(s: &str) -> Self {
        match s {
            "working" => State::Working,
            "waiting" => State::Waiting,
            "error" => State::Error,
            "completed" => State::Completed,
            "unknown" => State::Unknown,
            _ => State::Idle,
        }
    }

    fn key(self) -> &'static str {
        match self {
            State::Working => "working",
            State::Waiting => "waiting",
            State::Error => "error",
            State::Completed => "completed",
            State::Unknown => "unknown",
            State::Idle => "idle",
        }
    }
}

#[derive(Deserialize)]
struct SessionData {
    state: String,
    #[allow(dead_code)]
    message: Option<String>,
    timestamp: Option<u64>,
}

struct AppState {
    state: State,
    message: String,
    timestamp: u64,
    active_count: usize,
    blink_on: bool,
    completed_since: Option<u64>,
}

fn with_status_snapshot<R>(
    state: &Mutex<AppState>,
    dispatch: impl FnOnce(State, String, u64, usize) -> R,
) -> R {
    let (current, message, timestamp, count) = {
        let state = state.lock().unwrap();
        (
            state.state,
            state.message.clone(),
            state.timestamp,
            state.active_count,
        )
    };
    dispatch(current, message, timestamp, count)
}

fn with_blink_icon_key<R>(state: &Mutex<AppState>, dispatch: impl FnOnce(&str) -> R) -> R {
    let key = {
        let mut state = state.lock().unwrap();
        match state.state {
            State::Working | State::Waiting | State::Error => {
                state.blink_on = !state.blink_on;
                if state.blink_on {
                    state.state.key().to_string()
                } else {
                    "off".to_string()
                }
            }
            _ => state.state.key().to_string(),
        }
    };
    dispatch(&key)
}

fn sessions_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".code-light")
        .join("sessions")
}

fn now_secs() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_secs()
}

fn make_empty_icon() -> Image<'static> {
    let size = 64u32;
    let rgba = vec![0u8; (size * size * 4) as usize];
    Image::new_owned(rgba, size, size)
}

fn build_icons() -> HashMap<String, Image<'static>> {
    let color_map: &[(&str, &[u8])] = &[
        ("idle", include_bytes!("../icons/status/gray.png")),
        ("working", include_bytes!("../icons/status/green.png")),
        ("waiting", include_bytes!("../icons/status/yellow.png")),
        ("error", include_bytes!("../icons/status/red.png")),
        ("completed", include_bytes!("../icons/status/blue.png")),
    ];
    let mut map = HashMap::new();
    for (key, data) in color_map {
        let img = image::load_from_memory(data)
            .unwrap_or_else(|e| panic!("Failed to decode embedded icon '{}': {}", key, e));
        let rgba = img.to_rgba8();
        let (w, h) = (rgba.width(), rgba.height());
        map.insert(key.to_string(), Image::new_owned(rgba.into_raw(), w, h));
    }
    map.insert("off".to_string(), make_empty_icon());
    map.insert("unknown".to_string(), map["idle"].clone());
    map
}

fn read_all_sessions() -> (State, String, u64, usize) {
    let dir = sessions_dir();
    read_all_sessions_in(&dir, now_secs())
}

fn read_all_sessions_in(dir: &Path, now: u64) -> (State, String, u64, usize) {
    let _ = fs::create_dir_all(dir);

    let Ok(entries) = fs::read_dir(dir) else {
        return (State::Idle, String::new(), 0, 0);
    };

    let mut best_state = State::Idle;
    let mut best_message = String::new();
    let mut best_ts: u64 = 0;
    let mut active_count: usize = 0;

    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }

        let Ok(metadata) = fs::metadata(&path) else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let mtime = modified
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();

        let age = now.saturating_sub(mtime);
        if age > SESSION_EXPIRE_SECS {
            let _ = fs::remove_file(&path);
            continue;
        }

        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(data) = serde_json::from_str::<SessionData>(&content) else {
            continue;
        };

        let mut state = State::from_str(&data.state);
        if age > SESSION_STALE_SECS && state != State::Completed {
            state = State::Unknown;
        }

        active_count += 1;
        if state > best_state {
            best_state = state;
            best_message = if state == State::Unknown {
                "No recent agent event".to_string()
            } else {
                data.message.unwrap_or_default()
            };
            best_ts = data.timestamp.unwrap_or(0);
        }
    }

    (best_state, best_message, best_ts, active_count)
}

fn cleanup_completed_sessions() {
    let dir = sessions_dir();
    let Ok(entries) = fs::read_dir(&dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") {
            continue;
        }
        if let Ok(content) = fs::read_to_string(&path) {
            if let Ok(data) = serde_json::from_str::<SessionData>(&content) {
                if data.state == "completed" {
                    let _ = fs::remove_file(&path);
                }
            }
        }
    }
}

fn get_hooks_dir() -> PathBuf {
    if let Ok(exe) = std::env::current_exe() {
        if let Some(parent) = exe.parent() {
            let bundled = parent.join("hooks");
            if bundled.is_dir() {
                return bundled;
            }

            let search_paths: &[&str] = if cfg!(target_os = "macos") {
                &["../Resources/hooks", "../Resources/_up_/hooks"]
            } else if cfg!(target_os = "linux") {
                &[
                    "../lib/vibe-coding-light/hooks",
                    "../lib/code-light/hooks",
                    "../resources/hooks",
                ]
            } else {
                &["../resources/hooks"]
            };

            for rel in search_paths {
                if let Ok(resolved) = parent.join(rel).canonicalize() {
                    if resolved.is_dir() {
                        return resolved;
                    }
                }
            }
        }
    }
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .join("hooks")
}

fn shell_command(hooks_dir: &std::path::Path, script: &str) -> String {
    let script_path = hooks_dir.join(script);
    let path = script_path.display().to_string();
    if cfg!(target_os = "windows") {
        let path = path.replace('\\', "/");
        format!("bash '{}'", path)
    } else {
        format!("bash '{}'", path)
    }
}

fn base_hooks_dir() -> PathBuf {
    dirs::home_dir()
        .unwrap_or_default()
        .join(".code-light")
        .join("hooks")
}

fn claude_local_hooks_dir() -> PathBuf {
    base_hooks_dir().join("claude")
}

fn codex_local_hooks_dir() -> PathBuf {
    base_hooks_dir().join("codex")
}

fn copy_hooks_to_local(src: &Path, dest: &Path) -> Result<(), String> {
    fs::create_dir_all(dest).map_err(|e| format!("Cannot create {}: {e}", dest.display()))?;
    let entries = fs::read_dir(src).map_err(|e| format!("Cannot read {}: {e}", src.display()))?;
    for entry in entries {
        let entry = entry.map_err(|e| format!("Cannot read hook entry: {e}"))?;
        let src_path = entry.path();
        if src_path.is_file() {
            let dest_path = dest.join(entry.file_name());
            fs::copy(&src_path, &dest_path)
                .map_err(|e| format!("Cannot copy {}: {e}", src_path.display()))?;
        }
    }
    Ok(())
}

fn load_hook_config(path: &Path) -> Result<serde_json::Value, String> {
    if !path.exists() {
        return Ok(serde_json::json!({}));
    }
    let content =
        fs::read_to_string(path).map_err(|e| format!("Cannot read {}: {e}", path.display()))?;
    let config: serde_json::Value = serde_json::from_str(&content)
        .map_err(|e| format!("Invalid JSON in {}: {e}", path.display()))?;
    if !config.is_object() {
        return Err(format!("Expected JSON object in {}", path.display()));
    }
    Ok(config)
}

fn is_code_light_hook(handler: &serde_json::Value, agent: &str) -> bool {
    handler["command"].as_str().is_some_and(|command| {
        command
            .replace('\\', "/")
            .contains(&format!("/.code-light/hooks/{agent}/"))
    })
}

fn merge_hook_defs(
    config: &mut serde_json::Value,
    defs: &serde_json::Value,
    agent: &str,
) -> Result<(), String> {
    let config = config
        .as_object_mut()
        .ok_or("Expected configuration object")?;
    let hooks = config
        .entry("hooks")
        .or_insert_with(|| serde_json::json!({}));
    let hooks = hooks.as_object_mut().ok_or("Expected hooks object")?;
    for (event, definitions) in defs.as_object().ok_or("Expected hook definitions")? {
        let groups = hooks.entry(event).or_insert_with(|| serde_json::json!([]));
        let groups = groups
            .as_array_mut()
            .ok_or(format!("Expected hooks.{event} array"))?;
        for group in groups.iter_mut() {
            if let Some(handlers) = group
                .get_mut("hooks")
                .and_then(serde_json::Value::as_array_mut)
            {
                handlers.retain(|handler| !is_code_light_hook(handler, agent));
            }
        }
        groups.retain(|group| {
            group["hooks"]
                .as_array()
                .is_none_or(|handlers| !handlers.is_empty())
        });
        groups.extend(
            definitions
                .as_array()
                .ok_or("Expected hook groups")?
                .iter()
                .cloned(),
        );
    }
    Ok(())
}

fn write_hook_config(path: &Path, config: &serde_json::Value) -> Result<(), String> {
    let parent = path
        .parent()
        .ok_or("Hook configuration has no parent directory")?;
    fs::create_dir_all(parent).map_err(|e| format!("Cannot create {}: {e}", parent.display()))?;
    let temp = path.with_extension(format!("code-light-{}.tmp", std::process::id()));
    let content = serde_json::to_vec_pretty(config).map_err(|e| e.to_string())?;
    fs::write(&temp, content).map_err(|e| format!("Cannot write {}: {e}", temp.display()))?;
    if let Ok(metadata) = fs::metadata(path) {
        fs::set_permissions(&temp, metadata.permissions())
            .map_err(|e| format!("Cannot preserve permissions for {}: {e}", path.display()))?;
    }
    fs::rename(&temp, path).map_err(|e| format!("Cannot replace {}: {e}", path.display()))?;
    Ok(())
}

fn setup_hooks() -> Result<(), String> {
    let settings_path = dirs::home_dir()
        .unwrap_or_default()
        .join(".claude")
        .join("settings.json");

    let mut settings = load_hook_config(&settings_path)?;

    let bundled_claude = get_hooks_dir().join("claude");
    let claude_dest = claude_local_hooks_dir();

    let hook_defs = serde_json::json!({
        "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": shell_command(&claude_dest, "pre-tool-use.sh") }] }],
        "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": shell_command(&claude_dest, "post-tool-use.sh") }] }],
        "PostToolUseFailure": [{ "matcher": "", "hooks": [{ "type": "command", "command": shell_command(&claude_dest, "post-tool-use-failure.sh") }] }],
        "Notification": [{ "matcher": "", "hooks": [{ "type": "command", "command": shell_command(&claude_dest, "notification.sh") }] }],
        "Stop": [{ "matcher": "", "hooks": [{ "type": "command", "command": shell_command(&claude_dest, "stop.sh") }] }],
    });

    merge_hook_defs(&mut settings, &hook_defs, "claude")?;
    copy_hooks_to_local(&bundled_claude, &claude_dest)?;
    fs::create_dir_all(sessions_dir()).map_err(|e| e.to_string())?;
    write_hook_config(&settings_path, &settings)?;
    Ok(())
}

fn setup_codex_hooks() -> Result<(), String> {
    let codex_dir = dirs::home_dir().unwrap_or_default().join(".codex");

    let hooks_json_path = codex_dir.join("hooks.json");

    let mut codex_config = load_hook_config(&hooks_json_path)?;

    let bundled_codex = get_hooks_dir().join("codex");
    let codex_dest = codex_local_hooks_dir();

    let hook_defs = serde_json::json!({
        "SessionStart": [{ "matcher": "", "hooks": [{ "type": "command", "command": shell_command(&codex_dest, "session_start.sh"), "statusMessage": "Vibe Coding Light: Session tracking" }] }],
        "PreToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": shell_command(&codex_dest, "pre_tool_use.sh"), "statusMessage": "Vibe Coding Light: Tracking" }] }],
        "PermissionRequest": [{ "matcher": "", "hooks": [{ "type": "command", "command": shell_command(&codex_dest, "permission_request.sh"), "statusMessage": "Vibe Coding Light: Waiting for approval" }] }],
        "PostToolUse": [{ "matcher": "", "hooks": [{ "type": "command", "command": shell_command(&codex_dest, "post_tool_use.sh") }] }],
        "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": shell_command(&codex_dest, "user_prompt_submit.sh") }] }],
        "Stop": [{ "hooks": [{ "type": "command", "command": shell_command(&codex_dest, "stop.sh"), "timeout": 30 }] }],
    });

    merge_hook_defs(&mut codex_config, &hook_defs, "codex")?;
    copy_hooks_to_local(&bundled_codex, &codex_dest)?;
    fs::create_dir_all(sessions_dir()).map_err(|e| e.to_string())?;
    write_hook_config(&hooks_json_path, &codex_config)?;
    Ok(())
}

#[cfg(target_os = "macos")]
fn make_window_transparent(window: &tauri::WebviewWindow) {
    use objc::runtime::{Class, Object, NO};
    use objc::{msg_send, sel, sel_impl};
    if let Ok(ptr) = window.ns_window() {
        unsafe {
            let ns_window = ptr as *mut Object;
            let clear: *mut Object = msg_send![Class::get("NSColor").unwrap(), clearColor];
            let _: () = msg_send![ns_window, setOpaque: NO];
            let _: () = msg_send![ns_window, setBackgroundColor: clear];
        }
    }
}

#[tauri::command]
fn get_current_state(state: tauri::State<'_, Arc<Mutex<AppState>>>) -> serde_json::Value {
    let s = state.lock().unwrap();
    serde_json::json!({
        "state": s.state.key(),
        "message": s.message,
        "timestamp": s.timestamp,
        "activeCount": s.active_count,
    })
}

#[cfg(target_os = "macos")]
fn show_pet_settings(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("settings") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    } else {
        WebviewWindowBuilder::new(app, "settings", WebviewUrl::App("settings.html".into()))
            .title(ui_copy::settings_title(current_locale(app)))
            .inner_size(760.0, 760.0)
            .min_inner_size(620.0, 540.0)
            .build()
            .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn open_pet_settings(app: tauri::AppHandle) -> Result<(), String> {
    #[cfg(target_os = "macos")]
    {
        show_pet_settings(&app)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = app;
        Err("Photo import is available on macOS".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let icons = Arc::new(Mutex::new(build_icons()));

    let app_state = Arc::new(Mutex::new(AppState {
        state: State::Idle,
        message: String::new(),
        timestamp: 0,
        active_count: 0,
        blink_on: true,
        completed_since: None,
    }));

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build())
        .manage(app_state.clone())
        .invoke_handler(tauri::generate_handler![
            get_current_state,
            get_app_locale,
            set_app_locale,
            pet_commands::prepare_pet_preview,
            pet_commands::save_photo_pet,
            pet_commands::save_pet_profile,
            pet_commands::list_photo_pets,
            pet_commands::select_pet,
            pet_commands::delete_photo_pet,
            pet_commands::get_active_pet,
            pet_commands::get_pet_import_capabilities,
            open_pet_settings
        ])
        .setup(move |app| {
            let pet_data_dir = app.path().app_data_dir()?;
            let preferences = pet_data_dir.join("preferences.json");
            let system_tag = sys_locale::get_locale();
            let locale_store = ui_locale::UiLocaleStore::load(preferences, system_tag.as_deref());
            let locale = locale_store.get();
            app.manage(Arc::new(Mutex::new(locale_store)));
            app.manage(pet_store::PetStore::new(pet_data_dir));
            let initial_icon = icons.lock().unwrap().get("idle").unwrap().clone();
            let labels = ui_copy::menu_labels(
                locale,
                true,
                &ui_copy::HookFeedback::Initial,
                &ui_copy::HookFeedback::Initial,
            );
            let toggle_pet_item =
                MenuItemBuilder::with_id("toggle_pet", &labels.toggle_pet).build(app)?;
            let whip_item = MenuItemBuilder::with_id("whip", &labels.whip).build(app)?;
            #[cfg(target_os = "macos")]
            let customize_item =
                MenuItemBuilder::with_id("customize_pet", &labels.customize_pet).build(app)?;
            let setup_claude_item =
                MenuItemBuilder::with_id("setup_claude", &labels.setup_claude).build(app)?;
            let setup_codex_item =
                MenuItemBuilder::with_id("setup_codex", &labels.setup_codex).build(app)?;
            let chinese_item = CheckMenuItemBuilder::with_id("language_zh", &labels.chinese)
                .checked(locale == ui_locale::AppLocale::ZhCn)
                .build(app)?;
            let english_item = CheckMenuItemBuilder::with_id("language_en", &labels.english)
                .checked(locale == ui_locale::AppLocale::En)
                .build(app)?;
            let language_menu = SubmenuBuilder::with_id(app, "language", &labels.language)
                .item(&chinese_item)
                .item(&english_item)
                .build()?;
            let quit_item = MenuItemBuilder::with_id("quit", &labels.quit).build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&toggle_pet_item)
                .item(&whip_item);
            #[cfg(target_os = "macos")]
            let menu = menu.item(&customize_item);
            let menu = menu
                .separator()
                .item(&setup_claude_item)
                .item(&setup_codex_item)
                .separator()
                .item(&language_menu)
                .separator()
                .item(&quit_item)
                .build()?;

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.manage(Arc::new(Mutex::new(TrayUi {
                toggle_pet: toggle_pet_item,
                whip: whip_item,
                customize_pet: {
                    #[cfg(target_os = "macos")]
                    {
                        Some(customize_item)
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        None
                    }
                },
                setup_claude: setup_claude_item,
                setup_codex: setup_codex_item,
                language: language_menu,
                chinese: chinese_item,
                english: english_item,
                quit: quit_item,
                pet_visible: true,
                claude_feedback: ui_copy::HookFeedback::Initial,
                codex_feedback: ui_copy::HookFeedback::Initial,
            })));
            let _tray = TrayIconBuilder::with_id("main")
                .icon(initial_icon)
                .menu(&menu)
                .tooltip(ui_copy::status_text(locale, State::Idle, "", 0, 0))
                .on_menu_event(move |app, event| match event.id().as_ref() {
                    "toggle_pet" => {
                        if let Some(window) = app.get_webview_window("pet") {
                            if let Ok(visible) = window.is_visible() {
                                if visible {
                                    let _ = window.hide();
                                } else {
                                    let _ = window.show();
                                    let _ = window.set_focus();
                                }
                                app.state::<Arc<Mutex<TrayUi>>>()
                                    .lock()
                                    .unwrap()
                                    .pet_visible = !visible;
                                refresh_tray_ui(app, current_locale(app));
                            }
                        }
                    }
                    "whip" => {
                        let _ = app.emit("whip", ());
                    }
                    #[cfg(target_os = "macos")]
                    "customize_pet" => {
                        if let Err(error) = show_pet_settings(app) {
                            eprintln!("Could not open pet settings: {error}");
                        }
                    }
                    "setup_claude" => match setup_hooks() {
                        Ok(()) => {
                            app.state::<Arc<Mutex<TrayUi>>>()
                                .lock()
                                .unwrap()
                                .claude_feedback = ui_copy::HookFeedback::Installed;
                            refresh_tray_ui(app, current_locale(app));
                        }
                        Err(error) => {
                            eprintln!("Vibe Coding Light Claude hook setup failed: {error}");
                            app.state::<Arc<Mutex<TrayUi>>>()
                                .lock()
                                .unwrap()
                                .claude_feedback = ui_copy::HookFeedback::Failed(error);
                            refresh_tray_ui(app, current_locale(app));
                        }
                    },
                    "setup_codex" => match setup_codex_hooks() {
                        Ok(()) => {
                            app.state::<Arc<Mutex<TrayUi>>>()
                                .lock()
                                .unwrap()
                                .codex_feedback = ui_copy::HookFeedback::Installed;
                            refresh_tray_ui(app, current_locale(app));
                        }
                        Err(error) => {
                            eprintln!("Vibe Coding Light Codex hook setup failed: {error}");
                            app.state::<Arc<Mutex<TrayUi>>>()
                                .lock()
                                .unwrap()
                                .codex_feedback = ui_copy::HookFeedback::Failed(error);
                            refresh_tray_ui(app, current_locale(app));
                        }
                    },
                    "language_zh" => {
                        if let Err(error) = set_app_locale_impl(app, ui_locale::AppLocale::ZhCn) {
                            eprintln!("Could not save interface language: {error}");
                        }
                        refresh_tray_ui(app, current_locale(app));
                    }
                    "language_en" => {
                        if let Err(error) = set_app_locale_impl(app, ui_locale::AppLocale::En) {
                            eprintln!("Could not save interface language: {error}");
                        }
                        refresh_tray_ui(app, current_locale(app));
                    }
                    "quit" => {
                        app.exit(0);
                    }
                    _ => {}
                })
                .on_tray_icon_event(|_tray, event| {
                    let _ = event;
                })
                .build(app)?;

            // Make pet window transparent on macOS
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("pet") {
                make_window_transparent(&window);
            }

            // Register global shortcut: Cmd+B (macOS) / Ctrl+B (others) → whip
            let shortcut_app = app.handle().clone();
            app.global_shortcut()
                .on_shortcut("CmdOrCtrl+B", move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = shortcut_app.emit("whip", ());
                    }
                })
                .ok();

            // Poll thread
            let poll_app = app.handle().clone();
            let poll_state = app_state.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(POLL_INTERVAL);
                let (state, message, ts, count) = read_all_sessions();
                let payload = {
                    let mut s = poll_state.lock().unwrap();
                    if s.state == State::Completed {
                        if let Some(since) = s.completed_since {
                            if now_secs() - since > COMPLETED_DISPLAY_SECS {
                                s.state = State::Idle;
                                s.completed_since = None;
                                drop(s);
                                cleanup_completed_sessions();
                                s = poll_state.lock().unwrap();
                            }
                        }
                    }
                    if state != s.state {
                        s.state = state;
                        s.message = message;
                        s.timestamp = ts;
                        s.active_count = count;
                        s.blink_on = true;
                        s.completed_since = if state == State::Completed {
                            Some(now_secs())
                        } else {
                            None
                        };

                        Some(serde_json::json!({
                            "state": s.state.key(),
                            "message": s.message,
                            "timestamp": s.timestamp,
                            "activeCount": s.active_count,
                        }))
                    } else {
                        if ts != s.timestamp || count != s.active_count {
                            s.message = message;
                            s.timestamp = ts;
                            s.active_count = count;
                        }
                        None
                    }
                };
                if let Some(payload) = payload {
                    let _ = poll_app.emit("state-changed", payload);
                }
                with_status_snapshot(&poll_state, |current, message, timestamp, count| {
                    let text = ui_copy::status_text(
                        current_locale(&poll_app),
                        current,
                        &message,
                        timestamp,
                        count,
                    );
                    if let Some(tray) = poll_app.tray_by_id("main") {
                        let _ = tray.set_tooltip(Some(&text));
                    }
                });
            });

            // Blink thread
            let blink_app = app.handle().clone();
            let blink_state = app_state.clone();
            let blink_icons = icons.clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(BLINK_INTERVAL);
                with_blink_icon_key(&blink_state, |key| {
                    let icon = blink_icons.lock().unwrap().get(key).unwrap().clone();
                    if let Some(tray) = blink_app.tray_by_id("main") {
                        let _ = tray.set_icon(Some(icon));
                    }
                });
            });

            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::ffi::OsString;
    use std::fs::{File, FileTimes};

    #[test]
    fn change_locale_publishes_only_after_save() {
        let dir = tempfile::tempdir().unwrap();
        let path = dir.path().join("preferences.json");
        let mut store = ui_locale::UiLocaleStore::load(path, Some("zh-CN"));
        let mut published = None;
        change_locale(&mut store, ui_locale::AppLocale::En, |locale| {
            published = Some(locale);
        })
        .unwrap();
        assert_eq!(published, Some(ui_locale::AppLocale::En));
        assert_eq!(store.get(), ui_locale::AppLocale::En);

        let blocker = dir.path().join("blocker");
        fs::write(&blocker, b"file").unwrap();
        let mut failing =
            ui_locale::UiLocaleStore::load(blocker.join("preferences.json"), Some("zh-CN"));
        let mut published = false;
        assert!(
            change_locale(&mut failing, ui_locale::AppLocale::En, |_| published = true).is_err()
        );
        assert!(!published);
        assert_eq!(failing.get(), ui_locale::AppLocale::ZhCn);
    }

    #[test]
    fn native_updates_release_state_lock_before_dispatch() {
        let state = Mutex::new(AppState {
            state: State::Working,
            message: "Running".into(),
            timestamp: 1,
            active_count: 1,
            blink_on: true,
            completed_since: None,
        });
        with_status_snapshot(&state, |current, message, _, _| {
            assert_eq!(current, State::Working);
            assert_eq!(message, "Running");
            assert!(
                state.try_lock().is_ok(),
                "native dispatch must not hold AppState"
            );
        });
        with_blink_icon_key(&state, |key| {
            assert_eq!(key, "off");
            assert!(
                state.try_lock().is_ok(),
                "native dispatch must not hold AppState"
            );
        });
    }

    static HOME_LOCK: Mutex<()> = Mutex::new(());

    struct TestHome {
        path: PathBuf,
        old: Option<OsString>,
    }

    impl TestHome {
        fn new() -> Self {
            let path = std::env::temp_dir().join(format!(
                "code-light-hooks-test-{}-{}",
                std::process::id(),
                now_secs()
            ));
            fs::create_dir_all(&path).unwrap();
            let old = std::env::var_os("HOME");
            std::env::set_var("HOME", &path);
            Self { path, old }
        }
    }

    impl Drop for TestHome {
        fn drop(&mut self) {
            if let Some(old) = &self.old {
                std::env::set_var("HOME", old);
            } else {
                std::env::remove_var("HOME");
            }
            fs::remove_dir_all(&self.path).unwrap();
        }
    }

    #[test]
    fn long_running_and_waiting_sessions_are_not_assumed_finished() {
        let home =
            std::env::temp_dir().join(format!("code-light-state-test-{}", std::process::id()));
        let dir = home.join(".code-light/sessions");
        fs::create_dir_all(&dir).unwrap();

        let now = now_secs();
        let working = dir.join("working.json");
        fs::write(
            &working,
            format!(r#"{{"state":"working","timestamp":{now}}}"#),
        )
        .unwrap();
        File::options()
            .write(true)
            .open(&working)
            .unwrap()
            .set_times(FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(now - 61)))
            .unwrap();
        assert_eq!(read_all_sessions_in(&dir, now).0, State::Working);

        fs::remove_file(&working).unwrap();
        let waiting = dir.join("waiting.json");
        fs::write(
            &waiting,
            format!(r#"{{"state":"waiting","timestamp":{now}}}"#),
        )
        .unwrap();
        File::options()
            .write(true)
            .open(&waiting)
            .unwrap()
            .set_times(FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(now - 31)))
            .unwrap();
        assert_eq!(read_all_sessions_in(&dir, now).0, State::Waiting);

        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn inactive_session_is_unknown_and_file_is_retained() {
        let home =
            std::env::temp_dir().join(format!("code-light-unknown-test-{}", std::process::id()));
        fs::create_dir_all(&home).unwrap();
        let path = home.join("working.json");
        let now = now_secs();
        fs::write(&path, format!(r#"{{"state":"working","timestamp":{now}}}"#)).unwrap();
        File::options()
            .write(true)
            .open(&path)
            .unwrap()
            .set_times(FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(now - 301)))
            .unwrap();

        assert_eq!(read_all_sessions_in(&home, now).0.key(), "unknown");
        assert!(
            path.exists(),
            "session file must remain available for later events"
        );

        fs::remove_dir_all(&home).unwrap();
    }

    #[test]
    fn setup_preserves_other_hooks_and_does_not_duplicate_own_hooks() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = TestHome::new();
        for agent in [".claude/settings.json", ".codex/hooks.json"] {
            let path = home.path.join(agent);
            fs::create_dir_all(path.parent().unwrap()).unwrap();
            fs::write(&path, r#"{"theme":"dark","hooks":{"PreToolUse":[{"matcher":"Bash","hooks":[{"type":"command","command":"echo existing"}]}],"Custom":[{"hooks":[{"type":"command","command":"echo custom"}]}]}}"#).unwrap();
        }

        setup_hooks().unwrap();
        setup_codex_hooks().unwrap();
        setup_hooks().unwrap();
        setup_codex_hooks().unwrap();

        for agent in [".claude/settings.json", ".codex/hooks.json"] {
            let path = home.path.join(agent);
            let config: serde_json::Value =
                serde_json::from_str(&fs::read_to_string(path).unwrap()).unwrap();
            assert_eq!(config["theme"], "dark");
            assert_eq!(
                config["hooks"]["Custom"][0]["hooks"][0]["command"],
                "echo custom"
            );
            assert_eq!(config["hooks"]["PreToolUse"].as_array().unwrap().len(), 2);
            assert_eq!(
                config["hooks"]["PreToolUse"][0]["hooks"][0]["command"],
                "echo existing"
            );
        }
    }

    #[test]
    fn setup_does_not_replace_invalid_existing_config() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = TestHome::new();
        let path = home.path.join(".claude/settings.json");
        fs::create_dir_all(path.parent().unwrap()).unwrap();
        fs::write(&path, "{ broken json").unwrap();

        assert!(setup_hooks().is_err());

        assert_eq!(fs::read_to_string(path).unwrap(), "{ broken json");
    }
}
