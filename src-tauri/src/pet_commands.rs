use crate::pet_image::{prepare_pet_asset, PetAsset, PetAssetKind, PetImageError, PetImageMode};
use crate::pet_store::{
    ActivePet, PetAssets, PetManifest, PetMotion, PetSlot, PetStore, PetStoreError,
};
use base64::{engine::general_purpose::STANDARD, Engine};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use tauri::{AppHandle, Emitter, State};

const PNG_DATA_URL_PREFIX: &str = "data:image/png;base64,";
const GIF_DATA_URL_PREFIX: &str = "data:image/gif;base64,";
const MAX_ASSET_BYTES: usize = 10 * 1024 * 1024;
const MAX_PROFILE_BYTES: usize = 25 * 1024 * 1024;

#[derive(Debug, Serialize)]
pub struct PetCommandError {
    code: String,
    detail: Option<String>,
}

impl PetCommandError {
    fn new(code: &str) -> Self {
        Self {
            code: code.into(),
            detail: None,
        }
    }
    fn internal(detail: impl Into<String>) -> Self {
        Self {
            code: "internal_error".into(),
            detail: Some(detail.into()),
        }
    }
}

impl From<PetImageError> for PetCommandError {
    fn from(error: PetImageError) -> Self {
        let code = match error {
            PetImageError::TooLarge => "too_large",
            PetImageError::UnsupportedFormat => "unsupported_format",
            PetImageError::Decode(_) => "invalid_image",
            PetImageError::NoSubject => "no_subject",
            PetImageError::NoTransparency => "no_transparency",
            PetImageError::InvalidAnimation => "invalid_animation",
            PetImageError::UnsupportedPlatform => "unsupported_platform",
        };
        Self::new(code)
    }
}

impl From<PetStoreError> for PetCommandError {
    fn from(error: PetStoreError) -> Self {
        match error {
            PetStoreError::Io(detail) => Self::internal(detail),
            PetStoreError::InvalidId => Self::new("invalid_id"),
            PetStoreError::InvalidName => Self::new("invalid_name"),
            PetStoreError::InvalidTransform => Self::new("invalid_transform"),
            PetStoreError::InvalidMotion => Self::new("invalid_motion"),
            PetStoreError::InvalidImage(_) => Self::new("invalid_image"),
            PetStoreError::InvalidManifest => Self::new("invalid_manifest"),
            PetStoreError::NotFound => Self::new("not_found"),
            PetStoreError::CannotDeleteBuiltin => Self::new("cannot_delete_builtin"),
        }
    }
}

#[derive(Serialize)]
pub struct ImportCapabilities {
    automatic: bool,
    transparent_png: bool,
    transparent_gif: bool,
}

#[tauri::command]
pub fn get_pet_import_capabilities() -> ImportCapabilities {
    ImportCapabilities {
        automatic: {
            #[cfg(target_os = "macos")]
            {
                crate::pet_vision::automatic_available()
            }
            #[cfg(not(target_os = "macos"))]
            {
                false
            }
        },
        transparent_png: true,
        transparent_gif: true,
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

fn decode_asset_data(payload: &PreparedAssetPayload) -> Result<PetAsset, PetCommandError> {
    let prefix = match payload.kind {
        PetAssetKind::Png => PNG_DATA_URL_PREFIX,
        PetAssetKind::Gif => GIF_DATA_URL_PREFIX,
    };
    let encoded = payload
        .data_url
        .strip_prefix(prefix)
        .ok_or_else(|| PetCommandError::new("mime_mismatch"))?;
    if encoded.len() > 14 * 1024 * 1024 {
        return Err(PetCommandError::new("too_large"));
    }
    let bytes = STANDARD
        .decode(encoded)
        .map_err(|_| PetCommandError::new("invalid_preview"))?;
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(PetCommandError::new("too_large"));
    }
    Ok(PetAsset {
        kind: payload.kind,
        bytes,
    })
}

fn decode_asset_payload(payload: &PreparedAssetPayload) -> Result<PetAsset, PetCommandError> {
    let asset = decode_asset_data(payload)?;
    verify_asset_kind(&asset)?;
    Ok(asset)
}

fn verify_asset_kind(asset: &PetAsset) -> Result<(), PetCommandError> {
    let actual =
        image::guess_format(&asset.bytes).map_err(|_| PetCommandError::new("invalid_image"))?;
    let expected = match asset.kind {
        PetAssetKind::Png => image::ImageFormat::Png,
        PetAssetKind::Gif => image::ImageFormat::Gif,
    };
    if actual != expected {
        return Err(PetCommandError::new("mime_mismatch"));
    }
    Ok(())
}

fn decode_profile_assets(
    payloads: &BTreeMap<PetSlot, PreparedAssetPayload>,
) -> Result<PetAssets, PetCommandError> {
    if !payloads.contains_key(&PetSlot::Default) {
        return Err(PetCommandError::new("default_required"));
    }
    let mut total = 0usize;
    let mut assets = BTreeMap::new();
    for (slot, payload) in payloads {
        let asset = decode_asset_data(payload)?;
        total = total
            .checked_add(asset.bytes.len())
            .ok_or_else(|| PetCommandError::new("profile_too_large"))?;
        if total > MAX_PROFILE_BYTES {
            return Err(PetCommandError::new("profile_too_large"));
        }
        assets.insert(*slot, asset);
    }
    for asset in assets.values() {
        verify_asset_kind(asset)?;
    }
    Ok(assets)
}

fn decode_png_data_url(data_url: &str) -> Result<Vec<u8>, PetCommandError> {
    let encoded = data_url
        .strip_prefix(PNG_DATA_URL_PREFIX)
        .ok_or_else(|| PetCommandError::new("mime_mismatch"))?;
    if encoded.len() > 14 * 1024 * 1024 {
        return Err(PetCommandError::new("too_large"));
    }
    STANDARD
        .decode(encoded)
        .map_err(|_| PetCommandError::new("invalid_preview"))
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
        motions: BTreeMap<PetSlot, PetMotion>,
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
            motions: manifest.motions,
        },
    }
}

#[tauri::command]
pub async fn prepare_pet_preview(
    input: Vec<u8>,
    mode: PetImageMode,
) -> Result<PreparedAssetPayload, PetCommandError> {
    tauri::async_runtime::spawn_blocking(move || {
        prepare_pet_asset(&input, mode)
            .map(|asset| asset_payload(&asset))
            .map_err(PetCommandError::from)
    })
    .await
    .map_err(|error| PetCommandError::internal(error.to_string()))?
}

#[tauri::command]
pub fn save_pet_profile(
    app: AppHandle,
    store: State<'_, PetStore>,
    name: String,
    assets: BTreeMap<PetSlot, PreparedAssetPayload>,
    scale: f32,
    motions: BTreeMap<PetSlot, PetMotion>,
) -> Result<PetManifest, PetCommandError> {
    let decoded = decode_profile_assets(&assets)?;
    let manifest = store
        .save_profile(&name, &decoded, scale, &motions)
        .map_err(PetCommandError::from)?;
    store.select(&manifest.id).map_err(PetCommandError::from)?;
    let _ = app.emit("pet-changed", ());
    Ok(manifest)
}

#[tauri::command]
pub fn save_photo_pet(
    app: AppHandle,
    store: State<'_, PetStore>,
    name: String,
    png_data_url: String,
    scale: f32,
) -> Result<PetManifest, PetCommandError> {
    let png = decode_png_data_url(&png_data_url)?;
    let manifest = store
        .save(&name, &png, scale)
        .map_err(PetCommandError::from)?;
    store.select(&manifest.id).map_err(PetCommandError::from)?;
    let _ = app.emit("pet-changed", ());
    Ok(manifest)
}

#[tauri::command]
pub fn list_photo_pets(store: State<'_, PetStore>) -> Result<Vec<PetManifest>, PetCommandError> {
    store.list().map_err(PetCommandError::from)
}

#[tauri::command]
pub fn select_pet(
    app: AppHandle,
    store: State<'_, PetStore>,
    id: String,
) -> Result<(), PetCommandError> {
    store.select(&id).map_err(PetCommandError::from)?;
    let _ = app.emit("pet-changed", ());
    Ok(())
}

#[tauri::command]
pub fn delete_photo_pet(
    app: AppHandle,
    store: State<'_, PetStore>,
    id: String,
) -> Result<(), PetCommandError> {
    store.delete(&id).map_err(PetCommandError::from)?;
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
    fn transparent_import_is_available_on_every_desktop_platform() {
        let capabilities = get_pet_import_capabilities();
        assert!(capabilities.transparent_png);
        assert!(capabilities.transparent_gif);
        #[cfg(not(target_os = "macos"))]
        assert!(!capabilities.automatic);
    }

    #[test]
    fn serializes_known_pet_error_codes() {
        let gif = PetCommandError::from(crate::pet_image::PetImageError::InvalidAnimation);
        assert_eq!(
            serde_json::to_value(gif).unwrap(),
            serde_json::json!({"code":"invalid_animation","detail":null})
        );
        let transform = PetCommandError::from(crate::pet_store::PetStoreError::InvalidTransform);
        assert_eq!(
            serde_json::to_value(transform).unwrap()["code"],
            "invalid_transform"
        );
        let missing = PetCommandError::from(crate::pet_store::PetStoreError::NotFound);
        assert_eq!(serde_json::to_value(missing).unwrap()["code"], "not_found");
    }

    #[test]
    fn retains_unknown_io_detail() {
        let error = PetCommandError::from(crate::pet_store::PetStoreError::Io(
            "permission denied".into(),
        ));
        assert_eq!(
            serde_json::to_value(error).unwrap(),
            serde_json::json!({"code":"internal_error","detail":"permission denied"})
        );
    }

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
        assert!(decode_profile_assets(&over_budget).unwrap_err().code == "profile_too_large");
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
            motions: BTreeMap::new(),
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
