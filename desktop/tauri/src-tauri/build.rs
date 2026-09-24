fn main() {
    // tauri.conf.json reads the product version from the workspace manifest.
    println!("cargo:rerun-if-changed=../../../package.json");
    tauri_build::build()
}
