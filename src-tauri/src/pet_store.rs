use crate::pet_image::{validate_pet_asset, PetAsset, PetAssetKind};
use serde::{Deserialize, Serialize};
use std::collections::BTreeMap;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const BUILTIN_CAT_ID: &str = "builtin-cat";
const SCHEMA_VERSION: u32 = 2;
const MAX_PROFILE_BYTES: usize = 25 * 1024 * 1024;
const MIN_SCALE: f32 = 0.5;
const MAX_SCALE: f32 = 0.95;
const MAX_OFFSET: i16 = 32;

#[derive(Clone, Copy, Debug, Eq, PartialEq, Ord, PartialOrd, Deserialize, Serialize)]
#[serde(rename_all = "snake_case")]
pub enum PetSlot {
    Default,
    Working,
    Waiting,
    Error,
    Completed,
}

impl PetSlot {
    fn name(self) -> &'static str {
        match self {
            Self::Default => "default",
            Self::Working => "working",
            Self::Waiting => "waiting",
            Self::Error => "error",
            Self::Completed => "completed",
        }
    }
}

pub type PetAssets = BTreeMap<PetSlot, PetAsset>;

fn asset_filename(slot: PetSlot, kind: PetAssetKind) -> String {
    let extension = match kind {
        PetAssetKind::Png => "png",
        PetAssetKind::Gif => "gif",
    };
    format!("{}.{}", slot.name(), extension)
}

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PetManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub scale: f32,
    pub offset_x: i16,
    pub offset_y: i16,
    pub created_at: i64,
    #[serde(default)]
    pub assets: BTreeMap<PetSlot, PetAssetKind>,
}

pub enum ActivePet {
    Builtin,
    Photo {
        manifest: PetManifest,
        assets: PetAssets,
        invalid_slots: Vec<PetSlot>,
    },
}

#[derive(Debug)]
pub enum PetStoreError {
    Io(String),
    InvalidId,
    InvalidName,
    InvalidTransform,
    InvalidImage(String),
    InvalidManifest,
    NotFound,
    CannotDeleteBuiltin,
}

impl std::fmt::Display for PetStoreError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::Io(error) => write!(f, "Could not save pet: {error}"),
            Self::InvalidId => write!(f, "Invalid pet ID"),
            Self::InvalidName => write!(f, "Pet name must contain 1–64 characters"),
            Self::InvalidTransform => {
                write!(f, "Pet size or position is outside the supported range")
            }
            Self::InvalidImage(error) => write!(f, "Invalid pet image: {error}"),
            Self::InvalidManifest => write!(f, "Pet settings are invalid"),
            Self::NotFound => write!(f, "Pet was not found"),
            Self::CannotDeleteBuiltin => write!(f, "The built-in cat cannot be deleted"),
        }
    }
}

impl std::error::Error for PetStoreError {}

fn io_error(error: std::io::Error) -> PetStoreError {
    PetStoreError::Io(error.to_string())
}

fn valid_transform(scale: f32, offset_x: i16, offset_y: i16, has_gif: bool) -> bool {
    if has_gif {
        // Uncropped GIFs may fill 128px. Reserve two source pixels for click motion.
        let margin = ((64.0 - scale * 66.0).floor() as i16).min(MAX_OFFSET);
        return scale.is_finite()
            && (MIN_SCALE..=MAX_SCALE).contains(&scale)
            && (-margin..=margin).contains(&offset_x)
            && (-margin..=margin).contains(&offset_y);
    }
    // The 224px subject is displayed at most 112px wide. Leave room for the
    // working rotation and the completed jump inside the 128px pet window.
    let side_margin = ((64.0 - scale * 61.0).floor() as i16).min(MAX_OFFSET);
    let top_margin = (scale * 72.0 - 64.0).ceil() as i16;
    scale.is_finite()
        && (MIN_SCALE..=MAX_SCALE).contains(&scale)
        && (-side_margin.max(0)..=side_margin).contains(&offset_x)
        && (top_margin.max(-MAX_OFFSET)..=side_margin).contains(&offset_y)
}

fn valid_photo_id(id: &str) -> bool {
    Uuid::parse_str(id)
        .map(|value| value.to_string() == id)
        .unwrap_or(false)
}

fn regular_path(path: &Path, directory: bool) -> bool {
    fs::symlink_metadata(path)
        .map(|metadata| {
            !metadata.file_type().is_symlink()
                && if directory {
                    metadata.is_dir()
                } else {
                    metadata.is_file()
                }
        })
        .unwrap_or(false)
}

#[derive(Deserialize, Serialize)]
struct SelectedPet {
    id: String,
}

pub struct PetStore {
    root: PathBuf,
}

impl PetStore {
    pub fn new(root: PathBuf) -> Self {
        Self { root }
    }

    fn pets_dir(&self) -> PathBuf {
        self.root.join("pets")
    }

    fn selection_path(&self) -> PathBuf {
        self.root.join("selected-pet.json")
    }

    fn selected_id(&self) -> Option<String> {
        let bytes = fs::read(self.selection_path()).ok()?;
        serde_json::from_slice::<SelectedPet>(&bytes)
            .ok()
            .map(|value| value.id)
    }

    fn read_photo(
        &self,
        id: &str,
    ) -> Result<(PetManifest, PetAssets, Vec<PetSlot>), PetStoreError> {
        if !valid_photo_id(id) {
            return Err(PetStoreError::InvalidId);
        }
        let directory = self.pets_dir().join(id);
        let manifest_path = directory.join("manifest.json");
        if !regular_path(&directory, true) || !regular_path(&manifest_path, false) {
            return Err(PetStoreError::NotFound);
        }
        let manifest: PetManifest =
            serde_json::from_slice(&fs::read(manifest_path).map_err(io_error)?)
                .map_err(|_| PetStoreError::InvalidManifest)?;
        if manifest.id != id
            || manifest.name.trim().is_empty()
            || manifest.name.chars().count() > 64
        {
            return Err(PetStoreError::InvalidManifest);
        }
        let declared = match manifest.schema_version {
            1 if manifest.assets.is_empty() => {
                BTreeMap::from([(PetSlot::Default, PetAssetKind::Png)])
            }
            SCHEMA_VERSION if manifest.assets.contains_key(&PetSlot::Default) => {
                manifest.assets.clone()
            }
            _ => return Err(PetStoreError::InvalidManifest),
        };
        if !valid_transform(
            manifest.scale,
            manifest.offset_x,
            manifest.offset_y,
            declared.values().any(|kind| *kind == PetAssetKind::Gif),
        ) {
            return Err(PetStoreError::InvalidManifest);
        }
        let mut assets = BTreeMap::new();
        let mut invalid_slots = Vec::new();
        for (slot, kind) in declared {
            let filename = if manifest.schema_version == 1 {
                "pet.png".to_string()
            } else {
                asset_filename(slot, kind)
            };
            let path = directory.join(filename);
            let validated = if regular_path(&path, false) {
                fs::read(&path).map_err(io_error).and_then(|bytes| {
                    let asset = PetAsset { kind, bytes };
                    validate_pet_asset(&asset)
                        .map_err(|error| PetStoreError::InvalidImage(error.to_string()))?;
                    Ok(asset)
                })
            } else {
                Err(PetStoreError::NotFound)
            };
            match validated {
                Ok(asset) => {
                    assets.insert(slot, asset);
                }
                Err(error) if slot == PetSlot::Default => return Err(error),
                Err(_) => invalid_slots.push(slot),
            }
        }
        Ok((manifest, assets, invalid_slots))
    }

    pub fn save(
        &self,
        name: &str,
        png: &[u8],
        scale: f32,
        offset_x: i16,
        offset_y: i16,
    ) -> Result<PetManifest, PetStoreError> {
        self.save_profile(
            name,
            &BTreeMap::from([(
                PetSlot::Default,
                PetAsset {
                    kind: PetAssetKind::Png,
                    bytes: png.to_vec(),
                },
            )]),
            scale,
            offset_x,
            offset_y,
        )
    }

    pub fn save_profile(
        &self,
        name: &str,
        assets: &PetAssets,
        scale: f32,
        offset_x: i16,
        offset_y: i16,
    ) -> Result<PetManifest, PetStoreError> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 64 {
            return Err(PetStoreError::InvalidName);
        }
        if !assets.contains_key(&PetSlot::Default) {
            return Err(PetStoreError::InvalidManifest);
        }
        if !valid_transform(
            scale,
            offset_x,
            offset_y,
            assets.values().any(|asset| asset.kind == PetAssetKind::Gif),
        ) {
            return Err(PetStoreError::InvalidTransform);
        }
        let total_bytes = assets
            .values()
            .try_fold(0usize, |total, asset| total.checked_add(asset.bytes.len()));
        if total_bytes.is_none_or(|bytes| bytes > MAX_PROFILE_BYTES) {
            return Err(PetStoreError::InvalidImage(
                "Pet assets exceed 25 MiB".into(),
            ));
        }
        for asset in assets.values() {
            validate_pet_asset(asset)
                .map_err(|error| PetStoreError::InvalidImage(error.to_string()))?;
        }
        let pets = self.pets_dir();
        fs::create_dir_all(&pets).map_err(io_error)?;
        let id = Uuid::new_v4().to_string();
        let created_at = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_err(|error| PetStoreError::Io(error.to_string()))?
            .as_secs() as i64;
        let manifest = PetManifest {
            schema_version: SCHEMA_VERSION,
            id: id.clone(),
            name: name.to_string(),
            scale,
            offset_x,
            offset_y,
            created_at,
            assets: assets
                .iter()
                .map(|(slot, asset)| (*slot, asset.kind))
                .collect(),
        };
        let staging = tempfile::Builder::new()
            .prefix(".pending-")
            .tempdir_in(&pets)
            .map_err(io_error)?;
        for (slot, asset) in assets {
            fs::write(
                staging.path().join(asset_filename(*slot, asset.kind)),
                &asset.bytes,
            )
            .map_err(io_error)?;
        }
        fs::write(
            staging.path().join("manifest.json"),
            serde_json::to_vec_pretty(&manifest).map_err(|_| PetStoreError::InvalidManifest)?,
        )
        .map_err(io_error)?;
        fs::rename(staging.path(), pets.join(id)).map_err(io_error)?;
        Ok(manifest)
    }

    pub fn list(&self) -> Result<Vec<PetManifest>, PetStoreError> {
        let pets = self.pets_dir();
        if !pets.exists() {
            return Ok(Vec::new());
        }
        let mut manifests = Vec::new();
        for entry in fs::read_dir(pets).map_err(io_error)? {
            let entry = entry.map_err(io_error)?;
            let id = entry.file_name().to_string_lossy().to_string();
            if let Ok((manifest, _, _)) = self.read_photo(&id) {
                manifests.push(manifest);
            }
        }
        manifests.sort_by(|a, b| {
            b.created_at
                .cmp(&a.created_at)
                .then_with(|| a.id.cmp(&b.id))
        });
        Ok(manifests)
    }

    pub fn select(&self, id: &str) -> Result<(), PetStoreError> {
        if id != BUILTIN_CAT_ID {
            self.read_photo(id)?;
        }
        fs::create_dir_all(&self.root).map_err(io_error)?;
        let mut staging = tempfile::NamedTempFile::new_in(&self.root).map_err(io_error)?;
        let selected = serde_json::to_vec(&SelectedPet { id: id.to_string() })
            .map_err(|_| PetStoreError::InvalidManifest)?;
        staging.write_all(&selected).map_err(io_error)?;
        staging
            .persist(self.selection_path())
            .map_err(|error| io_error(error.error))?;
        Ok(())
    }

    pub fn delete(&self, id: &str) -> Result<(), PetStoreError> {
        if id == BUILTIN_CAT_ID {
            return Err(PetStoreError::CannotDeleteBuiltin);
        }
        if !valid_photo_id(id) {
            return Err(PetStoreError::InvalidId);
        }
        self.read_photo(id)?;
        let directory = self.pets_dir().join(id);
        let tombstone = self
            .pets_dir()
            .join(format!(".deleting-{}", Uuid::new_v4()));
        fs::rename(&directory, &tombstone).map_err(io_error)?;
        if self.selected_id().as_deref() == Some(id) {
            if let Err(error) = self.select(BUILTIN_CAT_ID) {
                fs::rename(&tombstone, &directory).map_err(io_error)?;
                return Err(error);
            }
        }
        // The package is no longer selectable. Cleanup failure leaves only
        // an ignored tombstone; selection and event delivery stay consistent.
        let _ = fs::remove_dir_all(tombstone);
        Ok(())
    }

    pub fn active(&self) -> ActivePet {
        let Some(id) = self.selected_id() else {
            return ActivePet::Builtin;
        };
        if id == BUILTIN_CAT_ID {
            return ActivePet::Builtin;
        }
        match self.read_photo(&id) {
            Ok((manifest, assets, invalid_slots)) => ActivePet::Photo {
                manifest,
                assets,
                invalid_slots,
            },
            Err(_) => ActivePet::Builtin,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::pet_image::{PetAsset, PetAssetKind};
    use image::{codecs::gif::GifEncoder, DynamicImage, ImageFormat, Rgba, RgbaImage};
    use std::io::Cursor;

    fn processed_png() -> Vec<u8> {
        let mut image = RgbaImage::new(256, 256);
        for y in 80..176 {
            for x in 80..176 {
                image.put_pixel(x, y, Rgba([20, 60, 200, 255]));
            }
        }
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn transparent_gif() -> Vec<u8> {
        let mut bytes = Vec::new();
        let frames = (0..2).map(|index| {
            let mut image = RgbaImage::new(8, 8);
            image.put_pixel(index, 0, Rgba([250, 20, 30, 255]));
            image::Frame::from_parts(image, 0, 0, image::Delay::from_numer_denom_ms(100, 1))
        });
        GifEncoder::new(&mut bytes).encode_frames(frames).unwrap();
        bytes
    }

    fn two_asset_profile() -> PetAssets {
        BTreeMap::from([
            (
                PetSlot::Default,
                PetAsset {
                    kind: PetAssetKind::Png,
                    bytes: processed_png(),
                },
            ),
            (
                PetSlot::Working,
                PetAsset {
                    kind: PetAssetKind::Gif,
                    bytes: transparent_gif(),
                },
            ),
        ])
    }

    #[test]
    fn gif_profile_rejects_placements_that_crop_full_canvas() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let assets = two_asset_profile();
        assert!(matches!(
            store.save_profile("cropped", &assets, 0.8, 15, 0),
            Err(PetStoreError::InvalidTransform)
        ));
        assert!(matches!(
            store.save_profile("cropped", &assets, 0.95, 0, 5),
            Err(PetStoreError::InvalidTransform)
        ));
        assert!(store.save_profile("fits", &assets, 0.95, 1, 1).is_ok());
        assert!(store.save("static", &processed_png(), 0.95, 5, 5).is_ok());
    }

    #[test]
    fn opens_selected_v1_without_rewriting() {
        let root = tempfile::tempdir().unwrap();
        let id = Uuid::new_v4().to_string();
        let package = root.path().join("pets").join(&id);
        fs::create_dir_all(&package).unwrap();
        let png = processed_png();
        let manifest = serde_json::json!({
            "schema_version": 1, "id": id, "name": "legacy", "scale": 0.8,
            "offset_x": 0, "offset_y": 0, "created_at": 1
        });
        let manifest_bytes = serde_json::to_vec(&manifest).unwrap();
        fs::write(package.join("manifest.json"), &manifest_bytes).unwrap();
        fs::write(package.join("pet.png"), &png).unwrap();
        fs::write(
            root.path().join("selected-pet.json"),
            format!("{{\"id\":\"{id}\"}}"),
        )
        .unwrap();

        let reopened = PetStore::new(root.path().to_path_buf());
        match reopened.active() {
            ActivePet::Photo { assets, .. } => {
                assert_eq!(assets[&PetSlot::Default].bytes, png);
                assert_eq!(assets.len(), 1);
            }
            ActivePet::Builtin => panic!("selected version 1 pet was lost"),
        }
        assert_eq!(
            fs::read(package.join("manifest.json")).unwrap(),
            manifest_bytes
        );
        assert_eq!(fs::read(package.join("pet.png")).unwrap(), png);
    }

    #[test]
    fn round_trips_v2_and_falls_back_for_missing_optional() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let assets = two_asset_profile();
        let saved = store.save_profile("animated", &assets, 0.8, 0, 0).unwrap();
        assert_eq!(saved.schema_version, 2);
        assert!(root
            .path()
            .join("pets")
            .join(&saved.id)
            .join("default.png")
            .exists());
        store.select(&saved.id).unwrap();
        let reopened = PetStore::new(root.path().to_path_buf());
        match reopened.active() {
            ActivePet::Photo {
                assets,
                invalid_slots,
                ..
            } => {
                assert_eq!(assets[&PetSlot::Working].kind, PetAssetKind::Gif);
                assert!(invalid_slots.is_empty());
            }
            ActivePet::Builtin => panic!("version 2 pet was lost"),
        }
        fs::remove_file(root.path().join("pets").join(&saved.id).join("working.gif")).unwrap();
        match reopened.active() {
            ActivePet::Photo {
                assets,
                invalid_slots,
                ..
            } => {
                assert_eq!(assets[&PetSlot::Default].kind, PetAssetKind::Png);
                assert!(!assets.contains_key(&PetSlot::Working));
                assert_eq!(invalid_slots, vec![PetSlot::Working]);
            }
            ActivePet::Builtin => panic!("missing optional asset hid the whole pet"),
        }
    }

    #[test]
    fn rejects_bad_v2_without_selection_change() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let saved = store
            .save_profile("good", &two_asset_profile(), 0.8, 0, 0)
            .unwrap();
        store.select(&saved.id).unwrap();
        let before = store.list().unwrap().len();

        let huge = BTreeMap::from([
            (
                PetSlot::Default,
                PetAsset {
                    kind: PetAssetKind::Gif,
                    bytes: vec![0; 9 * 1024 * 1024],
                },
            ),
            (
                PetSlot::Working,
                PetAsset {
                    kind: PetAssetKind::Gif,
                    bytes: vec![0; 9 * 1024 * 1024],
                },
            ),
            (
                PetSlot::Waiting,
                PetAsset {
                    kind: PetAssetKind::Gif,
                    bytes: vec![0; 9 * 1024 * 1024],
                },
            ),
        ]);
        assert!(store.save_profile("huge", &huge, 0.8, 0, 0).is_err());
        let bad = BTreeMap::from([(
            PetSlot::Default,
            PetAsset {
                kind: PetAssetKind::Png,
                bytes: b"bad".to_vec(),
            },
        )]);
        assert!(store.save_profile("bad", &bad, 0.8, 0, 0).is_err());
        assert_eq!(store.list().unwrap().len(), before);
        assert_eq!(store.selected_id().as_deref(), Some(saved.id.as_str()));

        fs::write(
            root.path().join("pets").join(&saved.id).join("default.png"),
            b"bad",
        )
        .unwrap();
        assert!(matches!(store.active(), ActivePet::Builtin));
        assert!(root.path().join("pets").join(&saved.id).exists());
    }

    #[cfg(unix)]
    #[test]
    fn save_profile_preserves_selection_when_staging_is_unwritable() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let saved = store
            .save_profile("good", &two_asset_profile(), 0.8, 0, 0)
            .unwrap();
        store.select(&saved.id).unwrap();
        let pets = root.path().join("pets");
        fs::set_permissions(&pets, fs::Permissions::from_mode(0o500)).unwrap();
        let result = store.save_profile("new", &two_asset_profile(), 0.8, 0, 0);
        fs::set_permissions(&pets, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
        assert_eq!(store.selected_id().as_deref(), Some(saved.id.as_str()));
        assert_eq!(store.list().unwrap().len(), 1);
    }

    #[test]
    fn pet_store_restores_selected_photo_after_restart() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let saved = store.save("小熊 🐻", &processed_png(), 0.8, 2, -3).unwrap();
        assert_eq!(saved.schema_version, 2);
        assert_eq!(saved.name, "小熊 🐻");
        assert_ne!(saved.id, "builtin-cat");
        assert!(root
            .path()
            .join("pets")
            .join(&saved.id)
            .join("default.png")
            .exists());
        store.select(&saved.id).unwrap();

        let reopened = PetStore::new(root.path().to_path_buf());
        match reopened.active() {
            ActivePet::Photo {
                manifest, assets, ..
            } => {
                assert_eq!(manifest.id, saved.id);
                assert_eq!(manifest.scale, 0.8);
                assert_eq!(assets[&PetSlot::Default].bytes, processed_png());
            }
            ActivePet::Builtin => panic!("saved selection was not restored"),
        }
    }

    #[test]
    fn pet_store_rejects_invalid_image_without_committing_package() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        assert!(store.save("bad", b"not a png", 0.8, 0, 0).is_err());
        assert!(store.list().unwrap().is_empty());
    }

    #[test]
    fn pet_store_deletes_active_and_inactive_photos_safely() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let first = store.save("first", &processed_png(), 0.8, 0, 0).unwrap();
        let second = store.save("second", &processed_png(), 0.8, 0, 0).unwrap();
        store.select(&first.id).unwrap();
        store.delete(&second.id).unwrap();
        assert!(matches!(store.active(), ActivePet::Photo { .. }));
        store.delete(&first.id).unwrap();
        assert!(matches!(store.active(), ActivePet::Builtin));
    }

    #[test]
    fn pet_store_rejects_path_like_ids_and_bad_transforms() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        assert!(store.select("../../outside").is_err());
        assert!(store.delete("../../outside").is_err());
        assert!(store.save("bad", &processed_png(), f32::NAN, 0, 0).is_err());
        assert!(store.save("bad", &processed_png(), 0.8, 100, 0).is_err());
        assert!(store.save("clipped", &processed_png(), 1.0, 32, 0).is_err());
        assert!(store.save("clipped", &processed_png(), 0.95, 0, 0).is_err());
        assert!(store.save("fits", &processed_png(), 0.95, 5, 5).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn pet_store_preserves_selection_when_delete_cannot_move_package() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let saved = store.save("photo", &processed_png(), 0.8, 0, 0).unwrap();
        store.select(&saved.id).unwrap();
        let pets = root.path().join("pets");
        fs::set_permissions(&pets, fs::Permissions::from_mode(0o500)).unwrap();
        let result = store.delete(&saved.id);
        fs::set_permissions(&pets, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
        assert_eq!(store.selected_id().as_deref(), Some(saved.id.as_str()));
        assert!(matches!(store.active(), ActivePet::Photo { .. }));
    }

    #[cfg(unix)]
    #[test]
    fn pet_store_restores_package_when_selection_write_fails() {
        use std::os::unix::fs::PermissionsExt;
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let saved = store.save("photo", &processed_png(), 0.8, 0, 0).unwrap();
        store.select(&saved.id).unwrap();
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o500)).unwrap();
        let result = store.delete(&saved.id);
        fs::set_permissions(root.path(), fs::Permissions::from_mode(0o700)).unwrap();
        assert!(result.is_err());
        assert_eq!(store.selected_id().as_deref(), Some(saved.id.as_str()));
        assert!(matches!(store.active(), ActivePet::Photo { .. }));
    }

    #[test]
    fn pet_store_falls_back_without_deleting_broken_packages() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let saved = store.save("photo", &processed_png(), 0.8, 0, 0).unwrap();
        store.select(&saved.id).unwrap();
        let pet_dir = root.path().join("pets").join(&saved.id);
        std::fs::write(pet_dir.join("manifest.json"), b"{broken").unwrap();
        assert!(matches!(store.active(), ActivePet::Builtin));
        assert!(pet_dir.exists());
        assert!(pet_dir.join("default.png").exists());
    }

    #[test]
    fn pet_store_falls_back_when_selection_points_to_missing_photo() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let saved = store.save("photo", &processed_png(), 0.8, 0, 0).unwrap();
        store.select(&saved.id).unwrap();
        std::fs::remove_file(root.path().join("pets").join(&saved.id).join("default.png")).unwrap();
        assert!(matches!(
            PetStore::new(root.path().to_path_buf()).active(),
            ActivePet::Builtin
        ));
    }
}
