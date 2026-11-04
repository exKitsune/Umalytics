//! Verify two immutable files; decompress only assets requested by the browser.
use std::{fs,io::Read,path::Path};
include!(concat!(env!("OUT_DIR"),"/frontend.rs"));

fn matches(path:&Path,expected:&[u8])->bool{
    (||->std::io::Result<bool>{
        let mut file=fs::File::open(path)?;
        if file.metadata()?.len()!=expected.len() as u64{return Ok(false);}
        let mut buffer=vec![0u8;1024*1024];
        for chunk in expected.chunks(buffer.len()){
            file.read_exact(&mut buffer[..chunk.len()])?;
            if &buffer[..chunk.len()]!=chunk{return Ok(false);}
        }
        Ok(file.read(&mut buffer[..1])?==0)
    })().unwrap_or(false)
}

fn publish(path:&Path,bytes:&[u8])->Result<(),String>{
    crate::storage_paths::regular(path)?;
    if matches(path,bytes){return Ok(());}
    let temporary=path.with_extension(format!("{}-{}.partial",std::process::id(),std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos()));
    crate::storage_paths::regular(&temporary)?;
    fs::write(&temporary,bytes).map_err(|_|"Could not prepare desktop assets.")?;
    #[cfg(windows)]{
        use std::os::windows::ffi::OsStrExt;
        #[link(name="kernel32")] unsafe extern "system"{fn MoveFileExW(from:*const u16,to:*const u16,flags:u32)->i32;}
        let from:Vec<u16>=temporary.as_os_str().encode_wide().chain(Some(0)).collect();
        let to:Vec<u16>=path.as_os_str().encode_wide().chain(Some(0)).collect();
        if unsafe{MoveFileExW(from.as_ptr(),to.as_ptr(),1|8)}==0{let _=fs::remove_file(temporary);return Err("Could not publish desktop assets.".into());}
    }
    #[cfg(not(windows))]fs::rename(&temporary,path).map_err(|_|"Could not publish desktop assets.")?;
    Ok(())
}

pub fn prepare(data:&Path)->Result<(),String>{
    let root=data.join("runtime/frontend");crate::storage_paths::regular(&root)?;
    let bundle=root.join(BUNDLE_ID);crate::storage_paths::regular(&bundle)?;
    fs::create_dir_all(&bundle).map_err(|_|"Could not prepare desktop assets.")?;
    publish(&bundle.join("assets.pack"),PACK)?;
    publish(&bundle.join("manifest.json"),MANIFEST)?;
    publish(&root.join("current.json"),serde_json::json!({"schemaVersion":2,"bundle":BUNDLE_ID}).to_string().as_bytes())
}

pub fn current(data:&Path)->bool{
    let root=data.join("runtime/frontend");let bundle=root.join(BUNDLE_ID);
    let pointer=root.join("current.json");let pack=bundle.join("assets.pack");let manifest=bundle.join("manifest.json");
    if [&pointer,&pack,&manifest].iter().any(|p|crate::storage_paths::regular(p).is_err()){return false;}
    matches(&pointer,serde_json::json!({"schemaVersion":2,"bundle":BUNDLE_ID}).to_string().as_bytes())
        && fs::metadata(pack).is_ok_and(|m|m.is_file()&&m.len()==PACK.len() as u64)&&matches(&manifest,MANIFEST)
}
