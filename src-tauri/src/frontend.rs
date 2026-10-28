//! The desktop owns UI assets; the collector only serves their immutable bundle.
use std::{fs,path::Path};
use sha2::{Digest,Sha256};
include!(concat!(env!("OUT_DIR"),"/frontend.rs"));

pub fn prepare(data:&Path)->Result<(),String>{
    let mut digest=Sha256::new();
    for (name,bytes) in FILES{digest.update(name.as_bytes());digest.update(Sha256::digest(bytes));}
    let id:String=digest.finalize().iter().map(|b|format!("{b:02x}")).collect();
    let root=data.join("runtime/frontend");crate::storage_paths::regular(&root)?;
    let bundle=root.join(&id);crate::storage_paths::regular(&bundle)?;
    fs::create_dir_all(&bundle).map_err(|_|"Could not prepare desktop assets.")?;
    for (name,bytes) in FILES{
        use std::io::Read;
        let mut decoded=Vec::new();
        flate2::read::GzDecoder::new(*bytes).read_to_end(&mut decoded).map_err(|_|"Could not decode desktop assets.")?;
        let path=bundle.join(name);crate::storage_paths::regular(&path)?;
        if fs::read(&path).ok().as_deref()!=Some(decoded.as_slice()){
            fs::create_dir_all(path.parent().unwrap()).map_err(|_|"Could not prepare desktop asset folder.")?;
            fs::write(path,decoded).map_err(|_|"Could not write desktop assets.")?;
        }
    }
    let pointer=root.join("current.json");crate::storage_paths::regular(&pointer)?;
    let identity=serde_json::json!({"schemaVersion":1,"bundle":id}).to_string();
    if fs::read(&pointer).ok().as_deref()==Some(identity.as_bytes()){return Ok(());}
    let temporary=root.join(format!("current-{}.partial",std::process::id()));crate::storage_paths::regular(&temporary)?;
    fs::write(&temporary,identity).map_err(|_|"Could not prepare frontend identity.")?;
    // Python readers tolerate the short replacement window by retaining the last bundle.
    if pointer.exists(){fs::remove_file(&pointer).map_err(|_|"Could not replace frontend identity.")?;}
    fs::rename(temporary,pointer).map_err(|_|"Could not publish desktop assets.".into())
}
