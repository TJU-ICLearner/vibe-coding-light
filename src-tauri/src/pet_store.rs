use crate::pet_image::validate_processed_png;
use serde::{Deserialize, Serialize};
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};
use uuid::Uuid;

pub const BUILTIN_CAT_ID: &str = "builtin-cat";
const SCHEMA_VERSION: u32 = 1;
const MIN_SCALE: f32 = 0.5;
const MAX_SCALE: f32 = 1.0;
const MAX_OFFSET: i16 = 32;

#[derive(Clone, Debug, Deserialize, Serialize)]
pub struct PetManifest {
    pub schema_version: u32,
    pub id: String,
    pub name: String,
    pub scale: f32,
    pub offset_x: i16,
    pub offset_y: i16,
    pub created_at: i64,
}

pub enum ActivePet {
    Builtin,
    Photo { manifest: PetManifest, png: Vec<u8> },
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

fn valid_transform(scale: f32, offset_x: i16, offset_y: i16) -> bool {
    scale.is_finite()
        && (MIN_SCALE..=MAX_SCALE).contains(&scale)
        && (-MAX_OFFSET..=MAX_OFFSET).contains(&offset_x)
        && (-MAX_OFFSET..=MAX_OFFSET).contains(&offset_y)
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

    fn read_photo(&self, id: &str) -> Result<(PetManifest, Vec<u8>), PetStoreError> {
        if !valid_photo_id(id) {
            return Err(PetStoreError::InvalidId);
        }
        let directory = self.pets_dir().join(id);
        let manifest_path = directory.join("manifest.json");
        let image_path = directory.join("pet.png");
        if !regular_path(&directory, true)
            || !regular_path(&manifest_path, false)
            || !regular_path(&image_path, false)
        {
            return Err(PetStoreError::NotFound);
        }
        let manifest: PetManifest =
            serde_json::from_slice(&fs::read(manifest_path).map_err(io_error)?)
                .map_err(|_| PetStoreError::InvalidManifest)?;
        if manifest.schema_version != SCHEMA_VERSION
            || manifest.id != id
            || manifest.name.trim().is_empty()
            || manifest.name.chars().count() > 64
            || !valid_transform(manifest.scale, manifest.offset_x, manifest.offset_y)
        {
            return Err(PetStoreError::InvalidManifest);
        }
        let png = fs::read(image_path).map_err(io_error)?;
        validate_processed_png(&png)
            .map_err(|error| PetStoreError::InvalidImage(error.to_string()))?;
        Ok((manifest, png))
    }

    pub fn save(
        &self,
        name: &str,
        png: &[u8],
        scale: f32,
        offset_x: i16,
        offset_y: i16,
    ) -> Result<PetManifest, PetStoreError> {
        let name = name.trim();
        if name.is_empty() || name.chars().count() > 64 {
            return Err(PetStoreError::InvalidName);
        }
        if !valid_transform(scale, offset_x, offset_y) {
            return Err(PetStoreError::InvalidTransform);
        }
        validate_processed_png(png)
            .map_err(|error| PetStoreError::InvalidImage(error.to_string()))?;
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
        };
        let staging = tempfile::Builder::new()
            .prefix(".pending-")
            .tempdir_in(&pets)
            .map_err(io_error)?;
        fs::write(staging.path().join("pet.png"), png).map_err(io_error)?;
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
            if let Ok((manifest, _)) = self.read_photo(&id) {
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
        if self.selected_id().as_deref() == Some(id) {
            self.select(BUILTIN_CAT_ID)?;
        }
        fs::remove_dir_all(self.pets_dir().join(id)).map_err(io_error)
    }

    pub fn active(&self) -> ActivePet {
        let Some(id) = self.selected_id() else {
            return ActivePet::Builtin;
        };
        if id == BUILTIN_CAT_ID {
            return ActivePet::Builtin;
        }
        match self.read_photo(&id) {
            Ok((manifest, png)) => ActivePet::Photo { manifest, png },
            Err(_) => ActivePet::Builtin,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{DynamicImage, ImageFormat, Rgba, RgbaImage};
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

    #[test]
    fn pet_store_restores_selected_photo_after_restart() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let saved = store.save("小熊 🐻", &processed_png(), 0.8, 2, -3).unwrap();
        assert_eq!(saved.schema_version, 1);
        assert_eq!(saved.name, "小熊 🐻");
        assert_ne!(saved.id, "builtin-cat");
        assert!(root
            .path()
            .join("pets")
            .join(&saved.id)
            .join("pet.png")
            .exists());
        store.select(&saved.id).unwrap();

        let reopened = PetStore::new(root.path().to_path_buf());
        match reopened.active() {
            ActivePet::Photo { manifest, png } => {
                assert_eq!(manifest.id, saved.id);
                assert_eq!(manifest.scale, 0.8);
                assert_eq!(png, processed_png());
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
        assert!(pet_dir.join("pet.png").exists());
    }

    #[test]
    fn pet_store_falls_back_when_selection_points_to_missing_photo() {
        let root = tempfile::tempdir().unwrap();
        let store = PetStore::new(root.path().to_path_buf());
        let saved = store.save("photo", &processed_png(), 0.8, 0, 0).unwrap();
        store.select(&saved.id).unwrap();
        std::fs::remove_file(root.path().join("pets").join(&saved.id).join("pet.png")).unwrap();
        assert!(matches!(
            PetStore::new(root.path().to_path_buf()).active(),
            ActivePet::Builtin
        ));
    }
}
