mod app_updates;
#[cfg(target_os = "macos")]
mod login_item_macos;
mod notifications;
mod pet_commands;
mod pet_image;
#[cfg(target_os = "macos")]
mod pet_panel_macos;
mod pet_store;
#[cfg(target_os = "macos")]
mod pet_vision;
#[cfg(target_os = "macos")]
mod tray_panel;
mod ui_copy;
mod ui_locale;

pub fn run_statusline_proxy_from_args() -> bool {
    notifications::claude_quota::run_proxy_from_args()
}

use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{
    image::Image,
    menu::{
        CheckMenuItem, CheckMenuItemBuilder, Menu, MenuBuilder, MenuItem, MenuItemBuilder, Submenu,
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
    menu: Menu<tauri::Wry>,
    toggle_pet: MenuItem<tauri::Wry>,
    pet_action: MenuItem<tauri::Wry>,
    customize_pet: Option<MenuItem<tauri::Wry>>,
    notification_settings: Option<MenuItem<tauri::Wry>>,
    setup_claude: MenuItem<tauri::Wry>,
    setup_codex: MenuItem<tauri::Wry>,
    sessions: Submenu<tauri::Wry>,
    session_items: Vec<MenuItem<tauri::Wry>>,
    session_labels: Vec<String>,
    login_item: Option<CheckMenuItem<tauri::Wry>>,
    login_enabled: bool,
    login_pending_approval: bool,
    login_failed: bool,
    login_needs_install: bool,
    auto_updates: CheckMenuItem<tauri::Wry>,
    auto_updates_failed: bool,
    check_updates: MenuItem<tauri::Wry>,
    release_item: MenuItem<tauri::Wry>,
    release_visible: bool,
    update_running: bool,
    update_failed: bool,
    update_checked: bool,
    release_info: Option<app_updates::ReleaseInfo>,
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
    let _ = ui.pet_action.set_text(labels.pet_action);
    if let Some(item) = &ui.customize_pet {
        let _ = item.set_text(labels.customize_pet);
    }
    if let Some(item) = &ui.notification_settings {
        let _ = item.set_text(labels.notification_settings);
    }
    let _ = ui.setup_claude.set_text(labels.claude_hooks);
    let _ = ui.setup_codex.set_text(labels.codex_hooks);
    let _ = ui.sessions.set_text(ui_copy::session_menu_title(locale));
    if let Some(item) = &ui.login_item {
        let _ = item.set_text(ui_copy::login_item_label(
            locale,
            ui.login_pending_approval,
            ui.login_failed,
            ui.login_needs_install,
        ));
        let _ = item.set_checked(ui.login_enabled);
    }
    let auto_enabled = app
        .state::<Arc<Mutex<app_updates::UpdatePreferencesStore>>>()
        .lock()
        .unwrap()
        .get()
        .auto_check;
    let _ = ui
        .auto_updates
        .set_text(ui_copy::automatic_update_label(locale));
    let _ = ui.auto_updates.set_checked(auto_enabled);
    let _ = ui.check_updates.set_text(ui_copy::update_check_label(
        locale,
        ui.update_running,
        ui.update_failed,
        ui.update_checked && ui.release_info.is_none(),
    ));
    let _ = ui.check_updates.set_enabled(!ui.update_running);
    let _ = ui.release_item.set_text(ui_copy::release_label(
        locale,
        ui.release_info.as_ref().map(|value| value.version.as_str()),
        ui.update_checked,
    ));
    let should_show_release = ui.release_info.is_some();
    if should_show_release != ui.release_visible {
        let state = app.state::<Arc<Mutex<TrayUi>>>();
        let mut current = state.lock().unwrap();
        if should_show_release {
            let index = current
                .menu
                .items()
                .unwrap_or_default()
                .iter()
                .position(|item| item.id().as_ref() == "check_updates")
                .map(|position| position + 1)
                .unwrap_or(0);
            if current.menu.insert(&current.release_item, index).is_ok() {
                current.release_visible = true;
            }
        } else if current.menu.remove(&current.release_item).is_ok() {
            current.release_visible = false;
        }
    }
    let _ = ui.language.set_text(labels.language);
    let _ = ui.chinese.set_text(labels.chinese);
    let _ = ui.english.set_text(labels.english);
    let _ = ui.chinese.set_checked(locale == ui_locale::AppLocale::ZhCn);
    let _ = ui.english.set_checked(locale == ui_locale::AppLocale::En);
    let _ = ui.quit.set_text(labels.quit);
    refresh_session_menu(app, locale);
    if let Some(window) = app.get_webview_window("settings") {
        let _ = window.set_title(ui_copy::settings_title(locale));
    }
    if let Some(window) = app.get_webview_window("notifications") {
        let _ = window.set_title(ui_copy::notification_settings_title(locale));
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

fn handle_tray_menu_action(app: &tauri::AppHandle, id: &str) {
    match id {
        "toggle_pet" => {
            if let Some(window) = app.get_webview_window("pet") {
                if let Ok(visible) = window.is_visible() {
                    if visible {
                        let _ = window.hide();
                    } else {
                        #[cfg(target_os = "macos")]
                        if let Err(error) = pet_panel_macos::show_without_activation(app) {
                            eprintln!("Could not show pet panel: {error}");
                            let _ = window.show();
                        }
                        #[cfg(not(target_os = "macos"))]
                        {
                            let _ = window.show();
                            let _ = window.set_focus();
                        }
                    }
                    app.state::<Arc<Mutex<TrayUi>>>()
                        .lock()
                        .unwrap()
                        .pet_visible = !visible;
                    refresh_tray_ui(app, current_locale(app));
                }
            }
        }
        "pet_action" => {
            let _ = app.emit("pet", ());
        }
        #[cfg(target_os = "macos")]
        "customize_pet" => {
            if let Err(error) = show_pet_settings(app) {
                eprintln!("Could not open pet settings: {error}");
            }
        }
        #[cfg(target_os = "macos")]
        "notification_settings" => {
            if let Err(error) = show_notification_settings(app) {
                eprintln!("Could not open notification settings: {error}");
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
        #[cfg(target_os = "macos")]
        "launch_at_login" => {
            let enabled = app
                .state::<Arc<Mutex<TrayUi>>>()
                .lock()
                .unwrap()
                .login_enabled;
            let result = login_item_macos::set_enabled(!enabled);
            let state = app.state::<Arc<Mutex<TrayUi>>>();
            let mut ui = state.lock().unwrap();
            match result {
                Ok(status) => {
                    ui.login_enabled = matches!(
                        status,
                        login_item_macos::LoginStatus::Enabled
                            | login_item_macos::LoginStatus::RequiresApproval
                    );
                    ui.login_pending_approval =
                        status == login_item_macos::LoginStatus::RequiresApproval;
                    ui.login_failed = false;
                    ui.login_needs_install = false;
                }
                Err(error) => {
                    eprintln!("Login item change failed: {error}");
                    ui.login_failed = true;
                    ui.login_needs_install =
                        error.starts_with("Move Vibe Coding Light.app to Applications");
                }
            }
            drop(ui);
            refresh_tray_ui(app, current_locale(app));
        }
        "auto_updates" => {
            let state = app.state::<Arc<Mutex<app_updates::UpdatePreferencesStore>>>();
            let enabled = state.lock().unwrap().get().auto_check;
            let saved = { state.lock().unwrap().set_auto_check(!enabled) };
            if let Err(error) = saved {
                eprintln!("Could not save automatic update setting: {error}");
                app.state::<Arc<Mutex<TrayUi>>>()
                    .lock()
                    .unwrap()
                    .auto_updates_failed = true;
            } else if !enabled {
                app.state::<Arc<Mutex<TrayUi>>>()
                    .lock()
                    .unwrap()
                    .auto_updates_failed = false;
                request_update_check(app, true);
            } else {
                app.state::<Arc<Mutex<TrayUi>>>()
                    .lock()
                    .unwrap()
                    .auto_updates_failed = false;
            }
            refresh_tray_ui(app, current_locale(app));
        }
        "check_updates" => request_update_check(app, false),
        "open_release" => {
            use tauri_plugin_opener::OpenerExt;
            let release = app
                .state::<Arc<Mutex<TrayUi>>>()
                .lock()
                .unwrap()
                .release_info
                .clone();
            if let Some(release) = release {
                if let Err(error) = app.opener().open_url(release.url, None::<&str>) {
                    eprintln!("Could not open release page: {error}");
                }
            }
        }
        "quit" => {
            app.exit(0);
        }
        _ => {}
    }
}

fn current_locale(app: &tauri::AppHandle) -> ui_locale::AppLocale {
    app.state::<Arc<Mutex<ui_locale::UiLocaleStore>>>()
        .lock()
        .unwrap()
        .get()
}

#[cfg(target_os = "macos")]
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct TrayPanelState {
    locale: ui_locale::AppLocale,
    pet_visible: bool,
    toggle_pet_label: String,
    pet_action_label: String,
    customize_pet_label: String,
    notification_settings_label: String,
    setup_claude_label: String,
    setup_codex_label: String,
    sessions_title: String,
    sessions: Vec<String>,
    language_title: String,
    chinese_label: String,
    english_label: String,
    login_label: String,
    login_enabled: bool,
    login_available: bool,
    auto_updates_label: String,
    auto_updates_enabled: bool,
    auto_updates_failed: bool,
    check_updates_label: String,
    update_running: bool,
    release_label: Option<String>,
    quit_label: String,
}

#[cfg(target_os = "macos")]
fn tray_panel_state(app: &tauri::AppHandle) -> TrayPanelState {
    let locale = current_locale(app);
    refresh_session_menu(app, locale);
    let ui = app.state::<Arc<Mutex<TrayUi>>>().lock().unwrap().clone();
    let labels = ui_copy::menu_labels(
        locale,
        ui.pet_visible,
        &ui.claude_feedback,
        &ui.codex_feedback,
    );
    let auto_updates_enabled = app
        .state::<Arc<Mutex<app_updates::UpdatePreferencesStore>>>()
        .lock()
        .unwrap()
        .get()
        .auto_check;
    TrayPanelState {
        locale,
        pet_visible: ui.pet_visible,
        toggle_pet_label: labels.toggle_pet,
        pet_action_label: labels.pet_action,
        customize_pet_label: labels.customize_pet,
        notification_settings_label: labels.notification_settings,
        setup_claude_label: labels.claude_hooks,
        setup_codex_label: labels.codex_hooks,
        sessions_title: ui_copy::session_menu_title(locale).into(),
        sessions: ui.session_labels.clone(),
        language_title: labels.language,
        chinese_label: labels.chinese,
        english_label: labels.english,
        login_label: ui_copy::login_item_label(
            locale,
            ui.login_pending_approval,
            ui.login_failed,
            ui.login_needs_install,
        )
        .into(),
        login_enabled: ui.login_enabled,
        login_available: ui
            .login_item
            .as_ref()
            .and_then(|item| item.is_enabled().ok())
            .unwrap_or(false),
        auto_updates_label: ui_copy::automatic_update_label(locale).into(),
        auto_updates_enabled,
        auto_updates_failed: ui.auto_updates_failed,
        check_updates_label: ui_copy::update_check_label(
            locale,
            ui.update_running,
            ui.update_failed,
            ui.update_checked && ui.release_info.is_none(),
        )
        .into(),
        update_running: ui.update_running,
        release_label: ui.release_info.as_ref().map(|release| {
            ui_copy::release_label(locale, Some(&release.version), ui.update_checked)
        }),
        quit_label: labels.quit,
    }
}

#[cfg(target_os = "macos")]
fn ensure_tray_panel_window(window: &tauri::WebviewWindow) -> Result<(), String> {
    if tray_panel::authorized_window(window.label()) {
        Ok(())
    } else {
        Err("Tray panel action is only available from the tray panel".into())
    }
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn get_tray_panel_state(window: tauri::WebviewWindow) -> Result<TrayPanelState, String> {
    ensure_tray_panel_window(&window)?;
    Ok(tray_panel_state(window.app_handle()))
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn perform_tray_panel_action(
    window: tauri::WebviewWindow,
    action: String,
) -> Result<TrayPanelState, String> {
    ensure_tray_panel_window(&window)?;
    let action_kind = tray_panel::TrayAction::parse(&action).ok_or("Unknown tray action")?;
    handle_tray_menu_action(window.app_handle(), &action);
    if action_kind.closes_panel() {
        let _ = window.hide();
    }
    Ok(tray_panel_state(window.app_handle()))
}

#[cfg(target_os = "macos")]
#[tauri::command]
fn hide_tray_panel(window: tauri::WebviewWindow) -> Result<(), String> {
    ensure_tray_panel_window(&window)?;
    window.hide().map_err(|error| error.to_string())
}

fn request_update_check(app: &tauri::AppHandle, automatic: bool) {
    let store = app.state::<Arc<Mutex<app_updates::UpdatePreferencesStore>>>();
    if automatic && !store.lock().unwrap().should_check(now_secs()) {
        return;
    }
    let ui_state = app.state::<Arc<Mutex<TrayUi>>>();
    {
        let mut ui = ui_state.lock().unwrap();
        if ui.update_running {
            return;
        }
        ui.update_running = true;
        ui.update_failed = false;
    }
    if let Err(error) = store.lock().unwrap().mark_checked(now_secs()) {
        eprintln!("Could not save update check time: {error}");
    }
    refresh_tray_ui(app, current_locale(app));
    let app = app.clone();
    std::thread::spawn(move || {
        let result = app_updates::fetch_release(env!("CARGO_PKG_VERSION"));
        let update_app = app.clone();
        let _ = app.run_on_main_thread(move || {
            if let Ok(release) = &result {
                let store = update_app.state::<Arc<Mutex<app_updates::UpdatePreferencesStore>>>();
                let saved = { store.lock().unwrap().save_result(release.as_ref()) };
                if let Err(error) = saved {
                    eprintln!("Could not cache update result: {error}");
                }
            }
            {
                let state = update_app.state::<Arc<Mutex<TrayUi>>>();
                let mut ui = state.lock().unwrap();
                ui.update_running = false;
                match result {
                    Ok(release) => {
                        ui.update_checked = true;
                        ui.update_failed = false;
                        ui.release_info = release;
                    }
                    Err(error) => {
                        eprintln!("Update check failed: {error}");
                        ui.update_failed = true;
                    }
                }
            }
            refresh_tray_ui(&update_app, current_locale(&update_app));
        });
    });
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
    agent: Option<String>,
    project: Option<String>,
}

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
enum SessionSource {
    Claude,
    Codex,
}

#[derive(Clone, Debug, PartialEq, Eq)]
struct SessionSummary {
    source: SessionSource,
    project: String,
    state: State,
    last_activity: u64,
}

fn clean_project_name(raw: &str) -> String {
    let name = Path::new(raw)
        .file_name()
        .and_then(|value| value.to_str())
        .unwrap_or(raw);
    let clean = name
        .chars()
        .filter(|c| !c.is_control())
        .take(40)
        .collect::<String>();
    if clean.trim().is_empty() {
        "—".into()
    } else {
        clean
    }
}

fn read_session_summaries_in(dir: &Path, now: u64) -> Vec<SessionSummary> {
    let Ok(entries) = fs::read_dir(dir) else {
        return Vec::new();
    };
    let mut summaries = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(metadata) = entry.metadata() else {
            continue;
        };
        let Ok(modified) = metadata.modified() else {
            continue;
        };
        let activity = modified
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_secs();
        if now.saturating_sub(activity) > SESSION_STALE_SECS {
            continue;
        }
        let Ok(content) = fs::read_to_string(&path) else {
            continue;
        };
        let Ok(data) = serde_json::from_str::<SessionData>(&content) else {
            continue;
        };
        let source = match data.agent.as_deref() {
            Some("claude") => SessionSource::Claude,
            Some("codex") => SessionSource::Codex,
            _ => continue,
        };
        let state = State::from_str(&data.state);
        if !matches!(
            state,
            State::Working | State::Waiting | State::Error | State::Completed
        ) {
            continue;
        }
        summaries.push(SessionSummary {
            source,
            project: clean_project_name(data.project.as_deref().unwrap_or("")),
            state,
            last_activity: activity,
        });
    }
    summaries.sort_by(|a, b| {
        b.last_activity
            .cmp(&a.last_activity)
            .then_with(|| a.project.cmp(&b.project))
    });
    summaries.truncate(8);
    summaries
}

fn refresh_session_menu(app: &tauri::AppHandle, locale: ui_locale::AppLocale) {
    let summaries = read_session_summaries_in(&sessions_dir(), now_secs());
    let labels = if summaries.is_empty() {
        vec![ui_copy::session_menu_empty(locale).to_string()]
    } else {
        summaries
            .iter()
            .map(|item| ui_copy::session_menu_item(locale, item, now_secs()))
            .collect()
    };
    let Some(ui) = app.try_state::<Arc<Mutex<TrayUi>>>() else {
        return;
    };
    let mut ui = ui.lock().unwrap();
    if ui.session_labels == labels {
        return;
    }
    let mut new_items = Vec::new();
    for (index, label) in labels.iter().enumerate() {
        let Ok(item) = MenuItemBuilder::with_id(format!("session_{index}"), label)
            .enabled(false)
            .build(app)
        else {
            return;
        };
        new_items.push(item);
    }
    for item in &ui.session_items {
        let _ = ui.sessions.remove(item);
    }
    for item in &new_items {
        let _ = ui.sessions.append(item);
    }
    ui.session_items = new_items;
    ui.session_labels = labels;
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

fn refresh_existing_hooks() {
    if claude_local_hooks_dir().join("stop.sh").is_file() {
        let _ = setup_hooks();
    }
    if codex_local_hooks_dir().join("stop.sh").is_file() {
        let _ = setup_codex_hooks();
    }
}

fn hook_install_current(agent: &str) -> bool {
    let source = get_hooks_dir().join(agent);
    let dest = base_hooks_dir().join(agent);
    let Ok(entries) = fs::read_dir(source) else {
        return false;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_file() {
            match (fs::read(&path), fs::read(dest.join(entry.file_name()))) {
                (Ok(source), Ok(installed)) if source == installed => {}
                _ => return false,
            }
        }
    }
    let config = if agent == "claude" {
        dirs::home_dir()
            .unwrap_or_default()
            .join(".claude/settings.json")
    } else {
        dirs::home_dir()
            .unwrap_or_default()
            .join(".codex/hooks.json")
    };
    let Ok(value) = load_hook_config(&config) else {
        return false;
    };
    ["Stop", "UserPromptSubmit"].iter().all(|event| {
        value["hooks"][event].as_array().is_some_and(|groups| {
            groups.iter().any(|group| {
                group["hooks"].as_array().is_some_and(|handlers| {
                    handlers
                        .iter()
                        .any(|handler| is_code_light_hook(handler, agent))
                })
            })
        })
    })
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
        "UserPromptSubmit": [{ "hooks": [{ "type": "command", "command": shell_command(&claude_dest, "user-prompt-submit.sh") }] }],
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

#[cfg(target_os = "macos")]
fn show_notification_settings(app: &tauri::AppHandle) -> Result<(), String> {
    if let Some(window) = app.get_webview_window("notifications") {
        window.show().map_err(|error| error.to_string())?;
        window.set_focus().map_err(|error| error.to_string())?;
    } else {
        WebviewWindowBuilder::new(
            app,
            "notifications",
            WebviewUrl::App("notifications.html".into()),
        )
        .title(ui_copy::notification_settings_title(current_locale(app)))
        .inner_size(740.0, 780.0)
        .min_inner_size(600.0, 600.0)
        .build()
        .map_err(|error| error.to_string())?;
    }
    Ok(())
}

#[cfg(target_os = "macos")]
fn toggle_tray_panel(app: &tauri::AppHandle, tray_rect: tauri::Rect) -> Result<(), String> {
    let window = if let Some(window) = app.get_webview_window("tray_panel") {
        if window.is_visible().map_err(|error| error.to_string())? {
            return window.hide().map_err(|error| error.to_string());
        }
        window
    } else {
        let window =
            WebviewWindowBuilder::new(app, "tray_panel", WebviewUrl::App("tray.html".into()))
                .title("Vibe Coding Light")
                .inner_size(360.0, 620.0)
                .decorations(false)
                .resizable(false)
                .always_on_top(true)
                .visible_on_all_workspaces(true)
                .skip_taskbar(true)
                .visible(false)
                .build()
                .map_err(|error| error.to_string())?;
        let close_window = window.clone();
        window.on_window_event(move |event| {
            if matches!(event, tauri::WindowEvent::Focused(false)) {
                let _ = close_window.hide();
            }
        });
        window
    };
    let tray_position = tray_rect.position.to_physical::<i32>(1.0);
    let tray_size = tray_rect.size.to_physical::<u32>(1.0);
    let monitor = app
        .monitor_from_point(tray_position.x as f64, tray_position.y as f64)
        .map_err(|error| error.to_string())?
        .or_else(|| window.current_monitor().ok().flatten())
        .ok_or("Could not locate tray display")?;
    let area = monitor.work_area();
    let panel_size = window.inner_size().map_err(|error| error.to_string())?;
    let (x, y) = tray_panel::panel_origin(
        tray_panel::ScreenRect {
            x: tray_position.x,
            y: tray_position.y,
            width: tray_size.width as i32,
            height: tray_size.height as i32,
        },
        tray_panel::ScreenRect {
            x: area.position.x,
            y: area.position.y,
            width: area.size.width as i32,
            height: area.size.height as i32,
        },
        panel_size.width as i32,
        panel_size.height as i32,
    );
    window
        .set_position(tauri::PhysicalPosition::new(x, y))
        .map_err(|error| error.to_string())?;
    window.show().map_err(|error| error.to_string())?;
    window.set_focus().map_err(|error| error.to_string())
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

    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_global_shortcut::Builder::new().build());
    #[cfg(target_os = "macos")]
    let builder = builder.plugin(tauri_nspanel::init());
    builder
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
            notifications::service::get_notification_settings,
            notifications::service::set_notification_settings,
            notifications::service::save_bark_key,
            notifications::service::delete_bark_key,
            notifications::service::send_test_notification,
            notifications::service::send_simulated_notification,
            notifications::service::get_notification_status,
            notifications::service::get_notification_diagnostics,
            notifications::service::clear_notification_diagnostics,
            #[cfg(target_os = "macos")]
            get_tray_panel_state,
            #[cfg(target_os = "macos")]
            perform_tray_panel_action,
            #[cfg(target_os = "macos")]
            hide_tray_panel,
            open_pet_settings
        ])
        .setup(move |app| {
            refresh_existing_hooks();
            let pet_data_dir = app.path().app_data_dir()?;
            let preferences = pet_data_dir.join("preferences.json");
            let update_preferences = pet_data_dir.join("updates.json");
            let system_tag = sys_locale::get_locale();
            let locale_store = ui_locale::UiLocaleStore::load(preferences, system_tag.as_deref());
            let locale = locale_store.get();
            app.manage(Arc::new(Mutex::new(locale_store)));
            app.manage(pet_store::PetStore::new(pet_data_dir.clone()));
            app.manage(Arc::new(Mutex::new(
                app_updates::UpdatePreferencesStore::load(update_preferences),
            )));
            let notification_service = notifications::service::NotificationService::start(
                app.handle().clone(),
                pet_data_dir,
            )
            .ok();
            app.manage(notification_service);
            let initial_icon = icons.lock().unwrap().get("idle").unwrap().clone();
            let labels = ui_copy::menu_labels(
                locale,
                true,
                &ui_copy::HookFeedback::Initial,
                &ui_copy::HookFeedback::Initial,
            );
            let toggle_pet_item =
                MenuItemBuilder::with_id("toggle_pet", &labels.toggle_pet).build(app)?;
            let pet_action_item =
                MenuItemBuilder::with_id("pet_action", &labels.pet_action).build(app)?;
            #[cfg(target_os = "macos")]
            let customize_item =
                MenuItemBuilder::with_id("customize_pet", &labels.customize_pet).build(app)?;
            #[cfg(target_os = "macos")]
            let notification_settings_item =
                MenuItemBuilder::with_id("notification_settings", &labels.notification_settings)
                    .build(app)?;
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
            #[cfg(target_os = "macos")]
            let initial_login = login_item_macos::status().ok();
            #[cfg(target_os = "macos")]
            let login_item = CheckMenuItemBuilder::with_id(
                "launch_at_login",
                ui_copy::login_item_label(
                    locale,
                    matches!(
                        initial_login,
                        Some(login_item_macos::LoginStatus::RequiresApproval)
                    ),
                    false,
                    false,
                ),
            )
            .checked(matches!(
                initial_login,
                Some(
                    login_item_macos::LoginStatus::Enabled
                        | login_item_macos::LoginStatus::RequiresApproval
                )
            ))
            .enabled(initial_login.is_some())
            .build(app)?;
            let update_store = app.state::<Arc<Mutex<app_updates::UpdatePreferencesStore>>>();
            let (auto_check, update_checked, cached_release) = {
                let store = update_store.lock().unwrap();
                (
                    store.get().auto_check,
                    store.get().checked_successfully,
                    store.cached_release(env!("CARGO_PKG_VERSION")),
                )
            };
            let auto_updates_item = CheckMenuItemBuilder::with_id(
                "auto_updates",
                ui_copy::automatic_update_label(locale),
            )
            .checked(auto_check)
            .build(app)?;
            let check_updates_item = MenuItemBuilder::with_id(
                "check_updates",
                ui_copy::update_check_label(
                    locale,
                    false,
                    false,
                    update_checked && cached_release.is_none(),
                ),
            )
            .build(app)?;
            let release_item = MenuItemBuilder::with_id(
                "open_release",
                ui_copy::release_label(
                    locale,
                    cached_release.as_ref().map(|value| value.version.as_str()),
                    update_checked,
                ),
            )
            .build(app)?;
            let empty_session_item =
                MenuItemBuilder::with_id("session_empty", ui_copy::session_menu_empty(locale))
                    .enabled(false)
                    .build(app)?;
            let sessions_menu =
                SubmenuBuilder::with_id(app, "sessions", ui_copy::session_menu_title(locale))
                    .item(&empty_session_item)
                    .build()?;
            let quit_item = MenuItemBuilder::with_id("quit", &labels.quit).build(app)?;
            let menu = MenuBuilder::new(app)
                .item(&toggle_pet_item)
                .item(&pet_action_item);
            #[cfg(target_os = "macos")]
            let menu = menu.item(&customize_item);
            #[cfg(target_os = "macos")]
            let menu = menu.item(&notification_settings_item);
            let menu = menu
                .separator()
                .item(&setup_claude_item)
                .item(&setup_codex_item)
                .item(&sessions_menu)
                .separator()
                .item(&language_menu);
            #[cfg(target_os = "macos")]
            let menu = menu.item(&login_item);
            let menu = menu.item(&auto_updates_item).item(&check_updates_item);
            let menu = if cached_release.is_some() {
                menu.item(&release_item)
            } else {
                menu
            };
            let menu = menu.separator().item(&quit_item).build()?;

            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            app.manage(Arc::new(Mutex::new(TrayUi {
                menu: menu.clone(),
                toggle_pet: toggle_pet_item,
                pet_action: pet_action_item,
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
                notification_settings: {
                    #[cfg(target_os = "macos")]
                    {
                        Some(notification_settings_item)
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        None
                    }
                },
                setup_claude: setup_claude_item,
                setup_codex: setup_codex_item,
                sessions: sessions_menu,
                session_items: vec![empty_session_item],
                session_labels: vec![ui_copy::session_menu_empty(locale).to_string()],
                login_item: {
                    #[cfg(target_os = "macos")]
                    {
                        Some(login_item)
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        None
                    }
                },
                login_enabled: {
                    #[cfg(target_os = "macos")]
                    {
                        matches!(
                            initial_login,
                            Some(
                                login_item_macos::LoginStatus::Enabled
                                    | login_item_macos::LoginStatus::RequiresApproval
                            )
                        )
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        false
                    }
                },
                login_pending_approval: {
                    #[cfg(target_os = "macos")]
                    {
                        matches!(
                            initial_login,
                            Some(login_item_macos::LoginStatus::RequiresApproval)
                        )
                    }
                    #[cfg(not(target_os = "macos"))]
                    {
                        false
                    }
                },
                login_failed: false,
                login_needs_install: false,
                auto_updates: auto_updates_item,
                auto_updates_failed: false,
                check_updates: check_updates_item,
                release_item,
                release_visible: cached_release.is_some(),
                update_running: false,
                update_failed: false,
                update_checked,
                release_info: cached_release,
                language: language_menu,
                chinese: chinese_item,
                english: english_item,
                quit: quit_item,
                pet_visible: true,
                claude_feedback: ui_copy::HookFeedback::Initial,
                codex_feedback: ui_copy::HookFeedback::Initial,
            })));
            let tray_builder = TrayIconBuilder::with_id("main")
                .icon(initial_icon)
                .menu(&menu)
                .tooltip(ui_copy::status_text(locale, State::Idle, "", 0, 0));
            #[cfg(target_os = "macos")]
            let tray_builder = tray_builder.show_menu_on_left_click(false);
            let _tray = tray_builder
                .on_menu_event(|app, event| handle_tray_menu_action(app, event.id().as_ref()))
                .on_tray_icon_event(|tray, event| {
                    #[cfg(target_os = "macos")]
                    if let tauri::tray::TrayIconEvent::Click {
                        rect,
                        button: tauri::tray::MouseButton::Left,
                        button_state: tauri::tray::MouseButtonState::Up,
                        ..
                    } = event
                    {
                        if let Err(error) = toggle_tray_panel(tray.app_handle(), rect) {
                            eprintln!("Could not show tray panel: {error}");
                        }
                    }
                    #[cfg(not(target_os = "macos"))]
                    let _ = (tray, event);
                })
                .build(app)?;
            refresh_session_menu(app.handle(), locale);
            request_update_check(app.handle(), true);

            // Place the pet in other apps' full-screen Spaces without activating this app.
            #[cfg(target_os = "macos")]
            if let Some(window) = app.get_webview_window("pet") {
                if let Err(error) = pet_panel_macos::configure(&window) {
                    eprintln!("Could not configure pet panel: {error}");
                }
                make_window_transparent(&window);
            }

            // Register global shortcut: Cmd+B (macOS) / Ctrl+B (others) → pat
            let shortcut_app = app.handle().clone();
            app.global_shortcut()
                .on_shortcut("CmdOrCtrl+B", move |_app, _shortcut, event| {
                    if event.state == ShortcutState::Pressed {
                        let _ = shortcut_app.emit("pet", ());
                    }
                })
                .ok();

            // Poll thread
            let poll_app = app.handle().clone();
            let poll_state = app_state.clone();
            let mut previous_session_labels = Vec::<String>::new();
            let mut update_tick = 0u8;
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
                let locale = current_locale(&poll_app);
                let now = now_secs();
                let summaries = read_session_summaries_in(&sessions_dir(), now);
                let labels = if summaries.is_empty() {
                    vec![ui_copy::session_menu_empty(locale).to_string()]
                } else {
                    summaries
                        .iter()
                        .map(|item| ui_copy::session_menu_item(locale, item, now))
                        .collect()
                };
                if labels != previous_session_labels {
                    previous_session_labels = labels;
                    let app = poll_app.clone();
                    let _ = poll_app.run_on_main_thread(move || refresh_session_menu(&app, locale));
                }
                update_tick = update_tick.wrapping_add(1);
                if update_tick >= 60 {
                    update_tick = 0;
                    let app = poll_app.clone();
                    let _ = poll_app.run_on_main_thread(move || request_update_check(&app, true));
                }
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
    fn session_summaries_filter_malformed_stale_and_unknown_sources_then_sort_and_cap() {
        let dir = tempfile::tempdir().unwrap();
        let now = now_secs();
        for index in 0..10 {
            let path = dir.path().join(format!("valid-{index}.json"));
            fs::write(&path, format!(r#"{{"state":"working","agent":"codex","project":"project-{index}","message":"private command","timestamp":{}}}"#, now - index)).unwrap();
            File::options()
                .write(true)
                .open(&path)
                .unwrap()
                .set_times(
                    FileTimes::new().set_modified(UNIX_EPOCH + Duration::from_secs(now - index)),
                )
                .unwrap();
        }
        fs::write(dir.path().join("bad.json"), "not json").unwrap();
        fs::write(
            dir.path().join("unknown.json"),
            format!(
                r#"{{"state":"working","agent":"other","project":"secret","timestamp":{now}}}"#
            ),
        )
        .unwrap();
        let stale = dir.path().join("stale.json");
        fs::write(
            &stale,
            format!(r#"{{"state":"waiting","agent":"claude","project":"old","timestamp":{now}}}"#),
        )
        .unwrap();
        File::options()
            .write(true)
            .open(&stale)
            .unwrap()
            .set_times(
                FileTimes::new()
                    .set_modified(UNIX_EPOCH + Duration::from_secs(now - SESSION_STALE_SECS - 1)),
            )
            .unwrap();
        let summaries = read_session_summaries_in(dir.path(), now);
        assert_eq!(summaries.len(), 8);
        assert_eq!(summaries[0].project, "project-0");
        assert_eq!(summaries[7].project, "project-7");
        assert_eq!(summaries[0].source, SessionSource::Codex);
        assert!(summaries.iter().all(|item| item.state == State::Working));
    }

    #[test]
    fn session_summaries_sanitize_project_and_keep_recent_completed() {
        let dir = tempfile::tempdir().unwrap();
        let now = now_secs();
        fs::write(dir.path().join("done.json"), format!(r#"{{"state":"completed","agent":"claude","project":"/private/path/demo\ncommand","timestamp":{now}}}"#)).unwrap();
        let summaries = read_session_summaries_in(dir.path(), now);
        assert_eq!(summaries.len(), 1);
        assert_eq!(summaries[0].source, SessionSource::Claude);
        assert_eq!(summaries[0].state, State::Completed);
        assert!(!summaries[0].project.contains('/'));
        assert!(!summaries[0].project.contains('\n'));
    }

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

    #[test]
    fn startup_upgrades_previously_installed_hooks_without_replacing_other_hooks() {
        let _lock = HOME_LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let home = TestHome::new();
        for agent in ["claude", "codex"] {
            let dest = home.path.join(format!(".code-light/hooks/{agent}"));
            fs::create_dir_all(&dest).unwrap();
            fs::write(dest.join("stop.sh"), "#!/bin/bash\n# old version\n").unwrap();
        }
        assert!(!hook_install_current("claude"));
        assert!(!hook_install_current("codex"));
        refresh_existing_hooks();
        assert!(
            fs::read_to_string(home.path.join(".code-light/hooks/claude/stop.sh"))
                .unwrap()
                .contains("write_notification_event")
        );
        assert!(
            fs::read_to_string(home.path.join(".code-light/hooks/codex/stop.sh"))
                .unwrap()
                .contains("write_notification_event")
        );
        let claude: serde_json::Value =
            serde_json::from_slice(&fs::read(home.path.join(".claude/settings.json")).unwrap())
                .unwrap();
        assert!(claude["hooks"]["UserPromptSubmit"].is_array());
        assert!(hook_install_current("claude"));
        assert!(hook_install_current("codex"));
    }
}
