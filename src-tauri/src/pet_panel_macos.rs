use block2::RcBlock;
use std::cell::RefCell;
use std::ptr::NonNull;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;
use tauri::WebviewWindow;
use tauri_nspanel::objc2_app_kit::{
    NSMenuDidBeginTrackingNotification, NSMenuDidEndTrackingNotification,
    NSWindowCollectionBehavior, NSWindowStyleMask,
};
use tauri_nspanel::objc2_foundation::{NSNotificationCenter, NSProcessInfo};
use tauri_nspanel::{tauri_panel, ManagerExt, PanelHandle, PanelLevel, WebviewWindowExt};

thread_local! {
    // These tokens must outlive the notification callbacks for the app's lifetime.
    static MENU_OBSERVERS: RefCell<Vec<tauri_nspanel::objc2::rc::Retained<tauri_nspanel::objc2::runtime::ProtocolObject<dyn tauri_nspanel::objc2_foundation::NSObjectProtocol>>>> =
        RefCell::new(Vec::new());
}

tauri_panel! {
    panel!(PetPanel {
        config: {
            can_become_key_window: true,
            can_become_main_window: false,
            is_floating_panel: true,
            hides_on_deactivate: false
        }
    })
}

// NSWindowCollectionBehavior flags from AppKit's NSWindow.h.
const CAN_JOIN_ALL_SPACES: u64 = 1 << 0;
const MANAGED: u64 = 1 << 2;
const TRANSIENT: u64 = 1 << 3;
const STATIONARY: u64 = 1 << 4;
const FULL_SCREEN_PRIMARY: u64 = 1 << 7;
const FULL_SCREEN_AUXILIARY: u64 = 1 << 8;
const FULL_SCREEN_NONE: u64 = 1 << 9;
const PRIMARY: u64 = 1 << 16;
const AUXILIARY: u64 = 1 << 17;
const CAN_JOIN_ALL_APPLICATIONS: u64 = 1 << 18;

fn pet_collection_behavior(existing: u64, macos_major: isize) -> u64 {
    let conflicting =
        MANAGED | TRANSIENT | FULL_SCREEN_PRIMARY | FULL_SCREEN_NONE | PRIMARY | AUXILIARY;
    let base = (existing & !conflicting) | CAN_JOIN_ALL_SPACES | STATIONARY | FULL_SCREEN_AUXILIARY;
    if macos_major >= 13 {
        base | CAN_JOIN_ALL_APPLICATIONS
    } else {
        base & !CAN_JOIN_ALL_APPLICATIONS
    }
}

fn pet_window_level(menu_tracking: bool) -> i64 {
    if menu_tracking {
        PanelLevel::Floating.value()
    } else {
        PanelLevel::ScreenSaver.value()
    }
}

fn lower_while_own_menu_tracks(panel: PanelHandle<tauri::Wry>) {
    let center = NSNotificationCenter::defaultCenter();
    let open_menus = Arc::new(AtomicUsize::new(0));
    let beginning_panel = panel.clone();
    let beginning_count = open_menus.clone();
    let beginning = RcBlock::new(
        move |_notification: NonNull<tauri_nspanel::NSNotification>| {
            beginning_count.fetch_add(1, Ordering::SeqCst);
            beginning_panel.set_level(pet_window_level(true));
        },
    );
    let ending = RcBlock::new(
        move |_notification: NonNull<tauri_nspanel::NSNotification>| {
            let previous = open_menus.fetch_update(Ordering::SeqCst, Ordering::SeqCst, |count| {
                Some(count.saturating_sub(1))
            });
            if matches!(previous, Ok(0 | 1)) {
                panel.set_level(pet_window_level(false));
            }
        },
    );
    let begin_name = unsafe { NSMenuDidBeginTrackingNotification };
    let end_name = unsafe { NSMenuDidEndTrackingNotification };
    let begin_token = unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(begin_name), None, None, &beginning)
    };
    let end_token = unsafe {
        center.addObserverForName_object_queue_usingBlock(Some(end_name), None, None, &ending)
    };
    MENU_OBSERVERS.with(|tokens| tokens.borrow_mut().extend([begin_token, end_token]));
}

pub fn configure(window: &WebviewWindow) -> Result<(), String> {
    // The Tauri window is converted exactly once, on the main thread during app setup.
    let panel = window
        .to_panel::<PetPanel>()
        .map_err(|error| error.to_string())?;
    let major_version = NSProcessInfo::processInfo()
        .operatingSystemVersion()
        .majorVersion;
    let existing = panel.as_panel().collectionBehavior().bits() as u64;
    let behavior = NSWindowCollectionBehavior::from_bits_retain(pet_collection_behavior(
        existing,
        major_version,
    ) as usize);
    panel.set_collection_behavior(behavior);
    panel
        .add_style_mask(NSWindowStyleMask::NonactivatingPanel)
        .map_err(|error| error.to_string())?;
    panel.set_floating_panel(true);
    panel.set_hides_on_deactivate(false);
    panel.set_level(pet_window_level(false));
    lower_while_own_menu_tracks(panel.clone());
    panel.order_front_regardless();
    Ok(())
}

pub fn show_without_activation(app: &tauri::AppHandle) -> Result<(), String> {
    let panel = app
        .get_webview_panel("pet")
        .map_err(|error| format!("{error:?}"))?;
    panel.show();
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn pet_can_join_other_apps_full_screen_spaces_on_macos_13_and_newer() {
        let existing = 1 << 5;
        let flags = pet_collection_behavior(existing, 26);
        assert_ne!(flags & existing, 0);
        assert_ne!(flags & CAN_JOIN_ALL_SPACES, 0);
        assert_ne!(flags & FULL_SCREEN_AUXILIARY, 0);
        assert_ne!(flags & CAN_JOIN_ALL_APPLICATIONS, 0);
    }

    #[test]
    fn older_macos_uses_available_full_screen_auxiliary_behavior() {
        let flags = pet_collection_behavior(0, 12);
        assert_ne!(flags & CAN_JOIN_ALL_SPACES, 0);
        assert_ne!(flags & FULL_SCREEN_AUXILIARY, 0);
        assert_eq!(flags & CAN_JOIN_ALL_APPLICATIONS, 0);
    }

    #[test]
    fn pet_replaces_conflicting_window_behaviors() {
        let existing = PRIMARY | MANAGED | FULL_SCREEN_PRIMARY;
        let flags = pet_collection_behavior(existing, 26);
        assert_eq!(flags & existing, 0);
        assert_ne!(flags & STATIONARY, 0);
        assert_ne!(flags & FULL_SCREEN_AUXILIARY, 0);
        assert_ne!(flags & CAN_JOIN_ALL_APPLICATIONS, 0);
    }

    #[test]
    fn pet_window_uses_a_level_above_full_screen_content() {
        assert_eq!(pet_window_level(false), 1000);
    }

    #[test]
    fn own_menus_can_cover_the_pet_while_they_are_open() {
        assert!(pet_window_level(true) < PanelLevel::PopUpMenu.value());
    }
}
