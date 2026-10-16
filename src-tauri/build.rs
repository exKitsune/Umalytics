fn main() {
    println!("cargo:rerun-if-env-changed=UMATRACE_SERVICE_DIGEST");
    println!("cargo:rerun-if-changed=../.cache/desktop-service/UmaTraceService.exe");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.rgba");
    tauri_build::build()
}
