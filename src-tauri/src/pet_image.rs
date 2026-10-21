use image::{
    imageops, DynamicImage, ImageDecoder, ImageError, ImageFormat, ImageReader, RgbaImage,
};
use std::io::Cursor;

const MAX_INPUT_BYTES: usize = 10 * 1024 * 1024;
const MAX_INPUT_SIDE: u32 = 4096;
const OUTPUT_SIDE: u32 = 256;
const CONTENT_SIDE: u32 = 224;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum PetImageMode {
    RemoveBackground,
    KeepAlpha,
}

#[derive(Debug, PartialEq, Eq)]
pub enum PetImageError {
    TooLarge,
    UnsupportedFormat,
    Decode(String),
    NoSubject,
    NoTransparency,
    UnsupportedPlatform,
}

impl std::fmt::Display for PetImageError {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        match self {
            Self::TooLarge => write!(f, "Image exceeds the 10 MiB or 4096-pixel limit"),
            Self::UnsupportedFormat => write!(f, "Choose a PNG or JPEG image"),
            Self::Decode(error) => write!(f, "Unable to read image: {error}"),
            Self::NoSubject => write!(f, "No visible subject was found"),
            Self::NoTransparency => write!(f, "Choose a PNG with a transparent background"),
            Self::UnsupportedPlatform => write!(f, "Automatic background removal is unavailable"),
        }
    }
}

impl std::error::Error for PetImageError {}

fn map_decode_error(error: ImageError) -> PetImageError {
    match error {
        ImageError::Limits(_) => PetImageError::TooLarge,
        other => PetImageError::Decode(other.to_string()),
    }
}

fn format_and_check_size(input: &[u8]) -> Result<ImageFormat, PetImageError> {
    if input.len() > MAX_INPUT_BYTES {
        return Err(PetImageError::TooLarge);
    }
    match image::guess_format(input) {
        Ok(format @ (ImageFormat::Png | ImageFormat::Jpeg)) => Ok(format),
        _ => Err(PetImageError::UnsupportedFormat),
    }
}

pub fn decode_oriented(input: &[u8]) -> Result<DynamicImage, PetImageError> {
    let format = format_and_check_size(input)?;
    let mut reader = ImageReader::with_format(Cursor::new(input), format);
    let mut limits = image::Limits::default();
    limits.max_image_width = Some(MAX_INPUT_SIDE);
    limits.max_image_height = Some(MAX_INPUT_SIDE);
    limits.max_alloc = Some(128 * 1024 * 1024);
    reader.limits(limits);
    let mut decoder = reader.into_decoder().map_err(map_decode_error)?;
    let (width, height) = decoder.dimensions();
    if width > MAX_INPUT_SIDE || height > MAX_INPUT_SIDE || width == 0 || height == 0 {
        return Err(PetImageError::TooLarge);
    }
    let orientation = decoder.orientation().map_err(map_decode_error)?;
    let mut image = DynamicImage::from_decoder(decoder).map_err(map_decode_error)?;
    image.apply_orientation(orientation);
    Ok(image)
}

fn normalize_visible(image: RgbaImage) -> Result<Vec<u8>, PetImageError> {
    let (width, height) = image.dimensions();
    let mut bounds = (width, height, 0, 0);
    let mut found = false;
    for (x, y, pixel) in image.enumerate_pixels() {
        if pixel.0[3] == 0 {
            continue;
        }
        found = true;
        bounds.0 = bounds.0.min(x);
        bounds.1 = bounds.1.min(y);
        bounds.2 = bounds.2.max(x);
        bounds.3 = bounds.3.max(y);
    }
    if !found {
        return Err(PetImageError::NoSubject);
    }
    let crop_width = bounds.2 - bounds.0 + 1;
    let crop_height = bounds.3 - bounds.1 + 1;
    let cropped =
        imageops::crop_imm(&image, bounds.0, bounds.1, crop_width, crop_height).to_image();
    let factor =
        (CONTENT_SIDE as f64 / crop_width as f64).min(CONTENT_SIDE as f64 / crop_height as f64);
    let resized_width = (crop_width as f64 * factor).round().max(1.0) as u32;
    let resized_height = (crop_height as f64 * factor).round().max(1.0) as u32;
    let resized = imageops::resize(
        &cropped,
        resized_width,
        resized_height,
        imageops::FilterType::Lanczos3,
    );
    let mut canvas = RgbaImage::new(OUTPUT_SIDE, OUTPUT_SIDE);
    let x = ((OUTPUT_SIDE - resized_width) / 2) as i64;
    let y = ((OUTPUT_SIDE - resized_height) / 2) as i64;
    imageops::overlay(&mut canvas, &resized, x, y);
    let mut bytes = Cursor::new(Vec::new());
    DynamicImage::ImageRgba8(canvas)
        .write_to(&mut bytes, ImageFormat::Png)
        .map_err(|error| PetImageError::Decode(error.to_string()))?;
    Ok(bytes.into_inner())
}

pub fn prepare_pet_image(input: &[u8], mode: PetImageMode) -> Result<Vec<u8>, PetImageError> {
    let format = format_and_check_size(input)?;
    match mode {
        PetImageMode::KeepAlpha => {
            if format != ImageFormat::Png {
                return Err(PetImageError::NoTransparency);
            }
            let image = decode_oriented(input)?.to_rgba8();
            if !image.pixels().any(|pixel| pixel.0[3] < 255) {
                return Err(PetImageError::NoTransparency);
            }
            normalize_visible(image)
        }
        PetImageMode::RemoveBackground => {
            #[cfg(target_os = "macos")]
            {
                let cutout = crate::pet_vision::remove_background(input)?;
                normalize_visible(decode_oriented(&cutout)?.to_rgba8())
            }
            #[cfg(not(target_os = "macos"))]
            {
                Err(PetImageError::UnsupportedPlatform)
            }
        }
    }
}

pub fn validate_processed_png(input: &[u8]) -> Result<(), PetImageError> {
    if format_and_check_size(input)? != ImageFormat::Png {
        return Err(PetImageError::UnsupportedFormat);
    }
    let image = decode_oriented(input)?.to_rgba8();
    if image.dimensions() != (OUTPUT_SIDE, OUTPUT_SIDE) {
        return Err(PetImageError::Decode("Expected a 256×256 PNG".into()));
    }
    if !image.pixels().any(|pixel| pixel.0[3] > 0) {
        return Err(PetImageError::NoSubject);
    }
    if !image.pixels().any(|pixel| pixel.0[3] < 255) {
        return Err(PetImageError::NoTransparency);
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use image::{
        codecs::jpeg::JpegEncoder, DynamicImage, ImageFormat, Rgb, RgbImage, Rgba, RgbaImage,
    };
    use std::io::Cursor;

    fn png(image: RgbaImage) -> Vec<u8> {
        let mut bytes = Cursor::new(Vec::new());
        DynamicImage::ImageRgba8(image)
            .write_to(&mut bytes, ImageFormat::Png)
            .unwrap();
        bytes.into_inner()
    }

    fn oriented_jpeg() -> Vec<u8> {
        let mut image = RgbImage::new(40, 20);
        for (x, _y, pixel) in image.enumerate_pixels_mut() {
            *pixel = if x < 20 {
                Rgb([255, 0, 0])
            } else {
                Rgb([0, 0, 255])
            };
        }
        let mut jpeg = Vec::new();
        JpegEncoder::new_with_quality(&mut jpeg, 100)
            .encode_image(&DynamicImage::ImageRgb8(image))
            .unwrap();

        // EXIF orientation 6: rotate 90° clockwise. Insert APP1 after SOI.
        let exif: [u8; 32] = [
            b'E', b'x', b'i', b'f', 0, 0, b'I', b'I', 42, 0, 8, 0, 0, 0, 1, 0, 0x12, 0x01, 3, 0, 1,
            0, 0, 0, 6, 0, 0, 0, 0, 0, 0, 0,
        ];
        let mut result = vec![0xFF, 0xD8, 0xFF, 0xE1, 0, 34];
        result.extend_from_slice(&exif);
        result.extend_from_slice(&jpeg[2..]);
        result
    }

    #[test]
    fn pet_image_normalizes_visible_transparent_png() {
        let mut image = RgbaImage::new(16, 16);
        for y in 4..12 {
            for x in 6..10 {
                image.put_pixel(x, y, Rgba([255, 30, 20, 255]));
            }
        }
        let result = prepare_pet_image(&png(image), PetImageMode::KeepAlpha).unwrap();
        let result = image::load_from_memory(&result).unwrap().to_rgba8();
        assert_eq!(result.dimensions(), (256, 256));
        assert_eq!(result.get_pixel(0, 0).0[3], 0);
        assert_eq!(result.get_pixel(128, 128).0[3], 255);
    }

    #[test]
    fn pet_image_rejects_invisible_subject() {
        let error =
            prepare_pet_image(&png(RgbaImage::new(16, 16)), PetImageMode::KeepAlpha).unwrap_err();
        assert!(matches!(error, PetImageError::NoSubject));
    }

    #[test]
    fn pet_image_rejects_large_byte_count() {
        let error =
            prepare_pet_image(&vec![0; 10 * 1024 * 1024 + 1], PetImageMode::KeepAlpha).unwrap_err();
        assert!(matches!(error, PetImageError::TooLarge), "{error:?}");
    }

    #[test]
    fn pet_image_rejects_large_declared_dimensions() {
        let image = RgbaImage::new(4097, 1);
        let error = prepare_pet_image(&png(image), PetImageMode::KeepAlpha).unwrap_err();
        assert!(matches!(error, PetImageError::TooLarge), "{error:?}");
    }

    #[test]
    fn pet_image_applies_exif_orientation_to_jpeg() {
        let image = decode_oriented(&oriented_jpeg()).unwrap().to_rgb8();
        assert_eq!(image.dimensions(), (20, 40));
        let top = image.get_pixel(10, 5).0;
        let bottom = image.get_pixel(10, 35).0;
        assert!(top[0] > top[2], "top should be red: {top:?}");
        assert!(bottom[2] > bottom[0], "bottom should be blue: {bottom:?}");
    }

    #[test]
    fn pet_image_validator_accepts_normalized_png() {
        let mut image = RgbaImage::new(8, 8);
        image.put_pixel(4, 4, Rgba([20, 40, 60, 255]));
        let normalized = prepare_pet_image(&png(image), PetImageMode::KeepAlpha).unwrap();
        assert!(validate_processed_png(&normalized).is_ok());
    }

    #[test]
    fn pet_image_validator_rejects_wrong_size_and_invisible_png() {
        let mut small = RgbaImage::new(8, 8);
        small.put_pixel(4, 4, Rgba([20, 40, 60, 255]));
        assert!(validate_processed_png(&png(small)).is_err());
        assert!(matches!(
            validate_processed_png(&png(RgbaImage::new(256, 256))),
            Err(PetImageError::NoSubject)
        ));
    }
}
