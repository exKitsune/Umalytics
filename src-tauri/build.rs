fn main() {
    use std::{fs, path::Path,io::Write};
    fn collect(root:&Path, at:&Path, files:&mut Vec<(String,String)>) {
        for entry in fs::read_dir(at).expect("Frontend build is missing") {
            let path=entry.unwrap().path();
            if path==root.join("data"){continue;} // Reference data belongs to the collector.
            if path.is_dir(){collect(root,&path,files);}else{
                files.push((path.strip_prefix(root).unwrap().to_str().unwrap().replace('\\',"/"),path.canonicalize().unwrap().to_str().unwrap().to_owned()));
            }
        }
    }
    let root=Path::new("../dist");let mut files=Vec::new();collect(root,root,&mut files);files.sort();
    use sha2::{Digest,Sha256};
    let mut packed=Vec::new();
    let mut manifest=serde_json::Map::new();
    for (name,path) in files {
        let raw=fs::read(path).unwrap();
        let mut encoder=flate2::write::GzEncoder::new(Vec::new(),flate2::Compression::default());
        encoder.write_all(&raw).unwrap();let compressed=encoder.finish().unwrap();
        manifest.insert(name,serde_json::json!([packed.len(),compressed.len(),raw.len(),format!("{:x}",Sha256::digest(&raw))]));
        packed.extend_from_slice(&compressed);
    }
    let manifest=serde_json::to_vec(&manifest).unwrap();
    let id=format!("{:x}",Sha256::digest(&manifest));
    let out=std::path::PathBuf::from(std::env::var("OUT_DIR").unwrap());
    let pack_path=out.join("frontend.pack");let manifest_path=out.join("frontend-manifest.json");
    fs::write(&pack_path,packed).unwrap();fs::write(&manifest_path,manifest).unwrap();
    let source=format!("pub const BUNDLE_ID:&str={id:?};\npub const PACK:&[u8]=include_bytes!({:?});\npub const MANIFEST:&[u8]=include_bytes!({:?});\n",pack_path.to_str().unwrap(),manifest_path.to_str().unwrap());
    fs::write(out.join("frontend.rs"),source).unwrap();
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-env-changed=UMATRACE_SERVICE_DIGEST");
    println!("cargo:rerun-if-changed=../.cache/desktop-service/UmaTraceService.exe");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.rgba");
    tauri_build::build()
}
