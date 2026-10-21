use crate::pet_image::{decode_oriented, PetImageError};
use std::ffi::CString;
use std::fs;
use std::io::Write;

unsafe extern "C" {
    fn code_light_macos_major_version() -> i32;
    fn code_light_remove_background(input_path: *const i8, output_path: *const i8) -> i32;
}

fn supports_foreground_mask(major: u32) -> bool {
    major >= 14
}

pub fn automatic_available() -> bool {
    let major = unsafe { code_light_macos_major_version() };
    major >= 0 && supports_foreground_mask(major as u32)
}

pub fn remove_background(input: &[u8]) -> Result<Vec<u8>, PetImageError> {
    let major = unsafe { code_light_macos_major_version() };
    if major < 0 || !supports_foreground_mask(major as u32) {
        return Err(PetImageError::UnsupportedPlatform);
    }
    let image = decode_oriented(input)?;
    if !image.to_rgba8().pixels().any(|pixel| pixel.0[3] > 0) {
        return Err(PetImageError::NoSubject);
    }

    let directory =
        tempfile::tempdir().map_err(|error| PetImageError::Decode(error.to_string()))?;
    let input_path = directory.path().join("input.png");
    let output_path = directory.path().join("output.png");
    let mut encoded = std::io::Cursor::new(Vec::new());
    image
        .write_to(&mut encoded, image::ImageFormat::Png)
        .map_err(|error| PetImageError::Decode(error.to_string()))?;
    fs::File::create(&input_path)
        .and_then(|mut file| file.write_all(&encoded.into_inner()))
        .map_err(|error| PetImageError::Decode(error.to_string()))?;
    let input_c = CString::new(input_path.to_string_lossy().as_bytes())
        .map_err(|error| PetImageError::Decode(error.to_string()))?;
    let output_c = CString::new(output_path.to_string_lossy().as_bytes())
        .map_err(|error| PetImageError::Decode(error.to_string()))?;
    match unsafe { code_light_remove_background(input_c.as_ptr(), output_c.as_ptr()) } {
        0 => fs::read(output_path).map_err(|error| PetImageError::Decode(error.to_string())),
        1 => Err(PetImageError::UnsupportedPlatform),
        2 => Err(PetImageError::NoSubject),
        _ => Err(PetImageError::Decode(
            "Vision could not process this image".into(),
        )),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{imageops, DynamicImage, ImageFormat, Rgba, RgbaImage};
    use std::io::Cursor;

    fn png(image: RgbaImage) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    #[test]
    fn pet_vision_requires_macos_14() {
        assert!(!supports_foreground_mask(13));
        assert!(supports_foreground_mask(14));
        assert!(supports_foreground_mask(26));
    }

    #[test]
    fn pet_vision_rejects_empty_foreground() {
        let empty = png(RgbaImage::new(512, 512));
        let error = remove_background(&empty).unwrap_err();
        assert!(matches!(error, PetImageError::NoSubject));
    }

    #[test]
    fn pet_vision_cuts_out_foreground_fixture() {
        let sheet = image::load_from_memory(include_bytes!("../../public/pet/idle.png"))
            .unwrap()
            .to_rgba8();
        let cat = imageops::crop_imm(&sheet, 0, 0, 64, 64).to_image();
        let cat = imageops::resize(&cat, 384, 384, imageops::FilterType::Nearest);
        let mut photo = RgbaImage::from_pixel(512, 512, Rgba([235, 235, 235, 255]));
        imageops::overlay(&mut photo, &cat, 64, 64);

        let result = remove_background(&png(photo)).unwrap();
        let result = image::load_from_memory(&result).unwrap().to_rgba8();
        assert_eq!(result.dimensions(), (512, 512));
        assert_eq!(result.get_pixel(0, 0).0[3], 0);
        assert!(result.get_pixel(256, 256).0[3] > 0);
    }
}
