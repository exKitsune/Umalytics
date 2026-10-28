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
    let mut source=String::from("pub const FILES:&[(&str,&[u8])]=&[\n");
    for (index,(name,path)) in files.into_iter().enumerate() {
        let output=Path::new(&std::env::var("OUT_DIR").unwrap()).join(format!("frontend-{index}.gz"));
        let mut encoder=flate2::write::GzEncoder::new(Vec::new(),flate2::Compression::default());
        encoder.write_all(&fs::read(path).unwrap()).unwrap();fs::write(&output,encoder.finish().unwrap()).unwrap();
        let path=output.to_str().unwrap();source.push_str(&format!("({name:?},include_bytes!({path:?})),\n"));
    }
    source.push_str("];\n");
    fs::write(Path::new(&std::env::var("OUT_DIR").unwrap()).join("frontend.rs"),source).unwrap();
    println!("cargo:rerun-if-changed=../dist");
    println!("cargo:rerun-if-env-changed=UMATRACE_SERVICE_DIGEST");
    println!("cargo:rerun-if-changed=../.cache/desktop-service/UmaTraceService.exe");
    println!("cargo:rerun-if-changed=icons/icon.ico");
    println!("cargo:rerun-if-changed=icons/icon.rgba");
    tauri_build::build()
}
