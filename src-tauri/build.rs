fn main() {
    if std::env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("macos") {
        cc::Build::new()
            .file("native/pet_vision.m")
            .flag("-fobjc-arc")
            .compile("code_light_pet_vision");
        for framework in ["Foundation", "Vision", "CoreImage", "CoreVideo", "AppKit"] {
            println!("cargo:rustc-link-lib=framework={framework}");
        }
    }
    tauri_build::build()
}
