use crate::pet_image::{prepare_pet_asset, PetAsset, PetAssetKind, PetImageMode};
use crate::pet_store::{ActivePet, PetAssets, PetManifest, PetSlot, PetStore};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{AppHandle, Emitter, State};

const PNG_DATA_URL_PREFIX: &str = "data:image/png;base64,";
const GIF_DATA_URL_PREFIX: &str = "data:image/gif;base64,";
const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;
const MAX_PROFILE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Serialize)]
pub struct ImportCapabilities {
    automatic: bool,
    transparent_png: bool,
    transparent_gif: bool,
}

#[tauri::command]
pub fn get_pet_import_capabilities() -> ImportCapabilities {
    #[cfg(target_os = "macos")]
    {
        ImportCapabilities {
            automatic: crate::pet_vision::automatic_available(),
            transparent_png: true,
            transparent_gif: true,
        }
    }
    #[cfg(not(target_os = "macos"))]
    {
        ImportCapabilities {
            automatic: false,
            transparent_png: false,
            transparent_gif: false,
        }
    }
}

fn png_data_url(png: &[u8]) -> String {
    format!("{PNG_DATA_URL_PREFIX}{}", STANDARD.encode(png))
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PreparedAssetPayload {
    kind: PetAssetKind,
    data_url: String,
}

fn asset_payload(asset: &PetAsset) -> PreparedAssetPayload {
    let prefix = match asset.kind {
        PetAssetKind::Png => PNG_DATA_URL_PREFIX,
        PetAssetKind::Gif => GIF_DATA_URL_PREFIX,
    };
    PreparedAssetPayload {
        kind: asset.kind,
        data_url: format!("{prefix}{}", STANDARD.encode(&asset.bytes)),
    }
}

fn decode_asset_data(payload: &PreparedAssetPayload) -> Result<PetAsset, String> {
    let prefix = match payload.kind {
        PetAssetKind::Png => PNG_DATA_URL_PREFIX,
        PetAssetKind::Gif => GIF_DATA_URL_PREFIX,
    };
    let encoded = payload
        .data_url
        .strip_prefix(prefix)
        .ok_or("Image MIME does not match type")?;
    if encoded.len() > 14 * 1024 * 1024 {
        return Err("Image preview is too large".into());
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| "Invalid image preview data")?;
    if bytes.len() > MAX_ASSET_BYTES {
        return Err("Image preview exceeds 10 MiB".into());
    }
    Ok(PetAsset {
        kind: payload.kind,
        bytes,
    })
}

fn decode_asset_payload(payload: &PreparedAssetPayload) -> Result<PetAsset, String> {
    let asset = decode_asset_data(payload)?;
    verify_asset_kind(&asset)?;
    Ok(asset)
}

fn verify_asset_kind(asset: &PetAsset) -> Result<(), String> {
    let actual = image::guess_format(&asset.bytes).map_err(|_| "Invalid image format")?;
    let expected = match asset.kind {
        PetAssetKind::Png => image::ImageFormat::Png,
        PetAssetKind::Gif => image::ImageFormat::Gif,
    };
    if actual != expected {
        return Err("Image MIME does not match bytes".into());
    }
    Ok(())
}

fn decode_profile_assets(
    payloads: &BTreeMap<PetSlot, PreparedAssetPayload>,
) -> Result<PetAssets, String> {
    if !payloads.contains_key(&PetSlot::Default) {
        return Err("Default image is required".into());
    }
    let mut total = 0usize;
    let mut assets = BTreeMap::new();
    for (slot, payload) in payloads {
        let asset = decode_asset_data(payload)?;
        total = total
            .checked_add(asset.bytes.len())
            .ok_or("Pet assets exceed 25 MiB")?;
        if total > MAX_PROFILE_BYTES {
            return Err("Pet assets exceed 25 MiB".into());
        }
        assets.insert(*slot, asset);
    }
    for asset in assets.values() {
        verify_asset_kind(asset)?;
    }
    Ok(assets)
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
        assets: BTreeMap<PetSlot, PreparedAssetPayload>,
        invalid_slots: Vec<PetSlot>,
        scale: f32,
        offset_x: i16,
        offset_y: i16,
    },
}

fn active_payload(active: ActivePet) -> ActivePetPayload {
    match active {
        ActivePet::Builtin => ActivePetPayload::Builtin,
        ActivePet::Photo {
            manifest,
            assets,
            invalid_slots,
        } => ActivePetPayload::Photo {
            id: manifest.id,
            assets: assets
                .iter()
                .map(|(slot, asset)| (*slot, asset_payload(asset)))
                .collect(),
            invalid_slots,
            scale: manifest.scale,
            offset_x: manifest.offset_x,
            offset_y: manifest.offset_y,
        },
    }
}

#[tauri::command]
pub async fn prepare_pet_preview(
    input: Vec<u8>,
    mode: PetImageMode,
) -> Result<PreparedAssetPayload, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (input, mode);
        return Err("Photo import is available on macOS".into());
    }
    #[cfg(target_os = "macos")]
    {
        tauri::async_runtime::spawn_blocking(move || {
            prepare_pet_asset(&input, mode)
                .map(|asset| asset_payload(&asset))
                .map_err(|error| error.to_string())
        })
        .await
        .map_err(|error| format!("Image processing failed: {error}"))?
    }
}

#[tauri::command]
pub fn save_pet_profile(
    app: AppHandle,
    store: State<'_, PetStore>,
    name: String,
    assets: BTreeMap<PetSlot, PreparedAssetPayload>,
    scale: f32,
    offset_x: i16,
    offset_y: i16,
) -> Result<PetManifest, String> {
    #[cfg(not(target_os = "macos"))]
    {
        let _ = (app, store, name, assets, scale, offset_x, offset_y);
        return Err("Photo import is available on macOS".into());
    }
    #[cfg(target_os = "macos")]
    {
        let decoded = decode_profile_assets(&assets)?;
        let manifest = store
            .save_profile(&name, &decoded, scale, offset_x, offset_y)
            .map_err(|error| error.to_string())?;
        store
            .select(&manifest.id)
            .map_err(|error| error.to_string())?;
        let _ = app.emit("pet-changed", ());
        Ok(manifest)
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
    use crate::pet_image::{PetAsset, PetAssetKind};
    use std::collections::BTreeMap;

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

    #[test]
    fn round_trips_gif_payload() {
        let bytes = b"GIF89a\x01\x00\x01\x00".to_vec();
        let payload = asset_payload(&PetAsset {
            kind: PetAssetKind::Gif,
            bytes: bytes.clone(),
        });
        assert!(payload.data_url.starts_with("data:image/gif;base64,"));
        assert_eq!(decode_asset_payload(&payload).unwrap().bytes, bytes);
    }

    #[test]
    fn rejects_invalid_profile_payload() {
        let wrong_mime = PreparedAssetPayload {
            kind: PetAssetKind::Gif,
            data_url: png_data_url(b"GIF89a"),
        };
        assert!(decode_asset_payload(&wrong_mime).is_err());
        let bad_base64 = PreparedAssetPayload {
            kind: PetAssetKind::Png,
            data_url: "data:image/png;base64,@@@".into(),
        };
        assert!(decode_asset_payload(&bad_base64).is_err());
        assert!(decode_profile_assets(&BTreeMap::new()).is_err());
        assert!(
            serde_json::from_str::<BTreeMap<PetSlot, PreparedAssetPayload>>(
                r#"{"../outside":{"kind":"png","data_url":"data:image/png;base64,YQ=="}}"#
            )
            .is_err()
        );
        let large = PreparedAssetPayload {
            kind: PetAssetKind::Gif,
            data_url: format!(
                "data:image/gif;base64,{}",
                STANDARD.encode(vec![0; 9 * 1024 * 1024])
            ),
        };
        let over_budget = BTreeMap::from([
            (PetSlot::Default, large.clone()),
            (PetSlot::Working, large.clone()),
            (PetSlot::Waiting, large),
        ]);
        assert!(decode_profile_assets(&over_budget)
            .unwrap_err()
            .contains("25 MiB"));
    }

    #[test]
    fn serializes_v1_as_default_only() {
        let manifest = PetManifest {
            schema_version: 1,
            id: "legacy".into(),
            name: "legacy".into(),
            scale: 0.8,
            offset_x: 0,
            offset_y: 0,
            created_at: 1,
            assets: BTreeMap::new(),
        };
        let active = ActivePet::Photo {
            manifest,
            assets: BTreeMap::from([(
                PetSlot::Default,
                PetAsset {
                    kind: PetAssetKind::Png,
                    bytes: b"PNG".to_vec(),
                },
            )]),
            invalid_slots: Vec::new(),
        };
        let payload = serde_json::to_value(active_payload(active)).unwrap();
        assert_eq!(payload["kind"], "photo");
        assert_eq!(payload["assets"].as_object().unwrap().len(), 1);
        assert_eq!(payload["assets"]["default"]["kind"], "png");
    }
}
