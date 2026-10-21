use crate::pet_image::{prepare_pet_image, PetImageMode};
use crate::pet_store::{ActivePet, PetManifest, PetSlot, PetStore};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::Serialize;
use tauri::{AppHandle, Emitter, State};

const PNG_DATA_URL_PREFIX: &str = "data:image/png;base64,";

#[derive(Serialize)]
pub struct ImportCapabilities {
    automatic: bool,
    transparent_png: bool,
}

#[tauri::command]
pub fn get_pet_import_capabilities() -> ImportCapabilities {
    #[cfg(target_os = "macos")]
    {
        ImportCapabilities {
            automatic: crate::pet_vision::automatic_available(),
            transparent_png: true,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        ImportCapabilities {
            automatic: false,
            transparent_png: false,
        }
    }
}

fn png_data_url(png: &[u8]) -> String {
    format!("{PNG_DATA_URL_PREFIX}{}", STANDARD.encode(png))
}

fn decode_png_data_url(data_url: &str) -> Result<Vec<u8>, String> {
    let encoded = data_url
        .strip_prefix(PNG_DATA_URL_PREFIX)
        .ok_or("Expected a PNG preview")?;
    if encoded.len() > 14 * 1024 * 1024 {
        return Err("PNG preview is too large".into());
    }
    STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid PNG preview data".into())
}

#[derive(Serialize)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum ActivePetPayload {
    Builtin,
    Photo {
        id: String,
        image_data_url: String,
        scale: f32,
        offset_x: i16,
        offset_y: i16,
    },
}

fn active_payload(active: ActivePet) -> ActivePetPayload {
    match active {
        ActivePet::Builtin => ActivePetPayload::Builtin,
        ActivePet::Photo {
            manifest, assets, ..
        } => ActivePetPayload::Photo {
            id: manifest.id,
            image_data_url: png_data_url(&assets[&PetSlot::Default].bytes),
            scale: manifest.scale,
            offset_x: manifest.offset_x,
            offset_y: manifest.offset_y,
        },
    }
}

#[tauri::command]
pub async fn prepare_pet_preview(input: Vec<u8>, mode: PetImageMode) -> Result<String, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (input, mode);
        return Err("Photo import is available on macOS".into());
    }
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            prepare_pet_image(&input, mode)
                .map(|png| png_data_url(&png))
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| format!("Image processing failed: {error}"))?
    }
}

#[tauri::command]
pub fn save_photo_pet(
    app: AppHandle,
    store: State<'_, PetStore>,
    name: String,
    png_data_url: String,
    scale: f32,
    offset_x: i16,
    offset_y: i16,
) -> Result<PetManifest, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, store, name, png_data_url, scale, offset_x, offset_y);
        return Err("Photo import is available on macOS".into());
    }
    #[cfg(target_os = "macos")]
    {
        let png = decode_png_data_url(&png_data_url)?;
        let manifest = store
            .save(&name, &png, scale, offset_x, offset_y)
            .map_err(|error| error.to_string())?;
        store
            .select(&manifest.id)
            .map_err(|error| error.to_string())?;
        let _ = app.emit("pet-changed", ());
        Ok(manifest)
    }
}

#[tauri::command]
pub fn list_photo_pets(store: State<'_, PetStore>) -> Result<Vec<PetManifest>, String> {
    store.list().map_err(|error| error.to_string())
}

#[tauri::command]
pub fn select_pet(app: AppHandle, store: State<'_, PetStore>, id: String) -> Result<(), String> {
    store.select(&id).map_err(|error| error.to_string())?;
    let _ = app.emit("pet-changed", ());
    Ok(())
}

#[tauri::command]
pub fn delete_photo_pet(
    app: AppHandle,
    store: State<'_, PetStore>,
    id: String,
) -> Result<(), String> {
    store.delete(&id).map_err(|error| error.to_string())?;
    let _ = app.emit("pet-changed", ());
    Ok(())
}

#[tauri::command]
pub fn get_active_pet(store: State<'_, PetStore>) -> ActivePetPayload {
    active_payload(store.active())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn commands_reject_non_png_data_urls() {
        assert!(decode_png_data_url("data:image/jpeg;base64,YWJj").is_err());
        assert!(decode_png_data_url("data:image/png;base64,@@@").is_err());
    }

    #[test]
    fn commands_encode_builtin_payload() {
        let payload = active_payload(ActivePet::Builtin);
        assert_eq!(
            serde_json::to_value(payload).unwrap(),
            serde_json::json!({"kind":"builtin"})
        );
    }

    #[test]
    fn commands_round_trip_png_data_url() {
        let png = b"PNG test bytes";
        assert_eq!(decode_png_data_url(&png_data_url(png)).unwrap(), png);
    }
}
