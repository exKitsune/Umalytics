//! Portable replacement runs from a copy of the OLD executable in cache/update.
//! Trust comes from the compiled key and signed bytes, never transaction fields.
use std::{fs, io::Read, path::{Component, Path, PathBuf}, process::{Child, Command, Stdio}, thread, time::{Duration, Instant}};
use base64::{engine::general_purpose::STANDARD, Engine};
use ed25519_dalek::{Signature, VerifyingKey};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use crate::service_startup::ServiceEndpoint;
#[cfg(windows)]
use std::os::windows::{fs::{MetadataExt, OpenOptionsExt}, process::CommandExt};

const KEY: &str = include_str!("../../desktop/update-public-key.txt");
const MAX_EXE: u64 = 512 * 1024 * 1024;
const REPO: &str = "https://github.com/exKitsune/Umalytics";
const MANAGED:&[&str]=&["data/metadata.json","data/courses.json","data/course-geometry.json","data/simulator-skill-ids.json","data/reference-source.json","data/NOTICE.txt","data/UMA-TOOLS-LICENSE.txt","data/update-manifest.json","data/active.json","runtime/UmalyticsCollector.exe"];

fn bad<T>(message:&str)->Result<T,String>{Err(message.to_owned())}
fn hex(bytes:&[u8])->String{bytes.iter().map(|byte|format!("{byte:02x}")).collect()}
fn is_hex(text:&str,length:usize)->bool{text.len()==length&&text.bytes().all(|c|c.is_ascii_digit()||(b'a'..=b'f').contains(&c))}
fn field<'a>(value:&'a Value,key:&str)->Result<&'a str,String>{value[key].as_str().ok_or_else(||format!("Invalid update field: {key}."))}
fn exact_keys(value:&Value,keys:&[&str])->bool{value.as_object().is_some_and(|object|object.len()==keys.len()&&keys.iter().all(|key|object.contains_key(*key)))}
fn read_small(path:&Path,max:u64)->Result<Vec<u8>,String>{
    let file=fs::File::open(path).map_err(|_|"Could not read update metadata.")?;
    if file.metadata().map_err(|_|"Could not inspect update metadata.")?.len()>max{return bad("Update metadata exceeds its limit.");}
    let mut bytes=Vec::new();file.take(max+1).read_to_end(&mut bytes).map_err(|_|"Could not read update metadata.")?;
    if bytes.len() as u64>max{return bad("Update metadata exceeds its limit.");}Ok(bytes)
}
fn digest(path:&Path)->Result<String,String>{
    let mut file=fs::File::open(path).map_err(|_|"Could not read the update executable.")?;
    let expected=file.metadata().map_err(|_|"Could not inspect the update executable.")?.len();
    if expected==0||expected>MAX_EXE{return bad("Update executable size is invalid.");}
    let mut hash=Sha256::new();let mut buffer=[0u8;256*1024];let mut total=0u64;
    loop{let read=file.read(&mut buffer).map_err(|_|"Could not verify the update executable.")?;if read==0{break;}total+=read as u64;if total>MAX_EXE{return bad("Update executable exceeds its limit.");}hash.update(&buffer[..read]);}
    if total!=expected{return bad("Update executable changed while verifying.");}Ok(hex(&hash.finalize()))
}
fn path_equal(a:&Path,b:&Path)->bool{
    let (Ok(a),Ok(b))=(fs::canonicalize(a),fs::canonicalize(b))else{return false;};
    #[cfg(windows)]{a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy())}
    #[cfg(not(windows))]{a==b}
}
fn regular_path(path:&Path)->Result<(),String>{
    if !path.is_absolute()||path.components().any(|part|matches!(part,Component::ParentDir|Component::CurDir)){return bad("Update paths must be absolute and contained in the portable installation.");}
    // Inspect every existing ancestor, not only the last component. Windows
    // junctions are reparse points even when is_symlink() reports false.
    for ancestor in path.ancestors(){
        let metadata=fs::symlink_metadata(ancestor).map_err(|_|"An update path could not be inspected.")?;
        if metadata.file_type().is_symlink(){return bad("Update paths must not contain symbolic links.");}
        #[cfg(windows)]if metadata.file_attributes()&0x400!=0{return bad("Update paths must not contain junctions or reparse points.");}
    }Ok(())
}
fn safe_tree(path:&Path)->Result<(),String>{
    regular_path(path)?;
    if path.is_dir(){for entry in fs::read_dir(path).map_err(|_|"Could not inspect update backup files.")?{safe_tree(&entry.map_err(|_|"Could not inspect update backup files.")?.path())?;}}Ok(())
}
fn expected_path(value:&Value,key:&str,expected:&Path)->Result<PathBuf,String>{
    let saved=PathBuf::from(field(value,key)?);regular_path(&saved)?;
    if !path_equal(&saved,expected){return bad("Update transaction points outside its approved location.");}Ok(saved)
}
fn build(version:&str)->Option<u64>{let suffix=version.strip_prefix("0.2.")?;let number=suffix.parse::<u64>().ok()?;if version==format!("0.2.{number}"){Some(number)}else{None}}

struct Plan{install:PathBuf,exe:PathBuf,data:PathBuf,folder:PathBuf,stage:PathBuf,backup:PathBuf,manifest:Value,token:String,previous:String,old_hash:String}
impl Plan{
    fn load(transaction:&Path,key:&[u8;32],recovery:bool)->Result<Self,String>{
        regular_path(transaction)?;
        let value:Value=serde_json::from_slice(&read_small(transaction,16384)?).map_err(|_|"Update transaction is invalid.")?;
        if !exact_keys(&value,&["schemaVersion","installationDir","executablePath","dataDirectory","stagedExecutable","manifestPath","signaturePath","previousVersion","version","expectedOldExeSha256","token"])||value["schemaVersion"].as_u64()!=Some(1){return bad("Update transaction schema is unsupported.");}
        let install=PathBuf::from(field(&value,"installationDir")?);regular_path(&install)?;
        if !install.is_dir(){return bad("Portable installation is unavailable.");}
        let exe=expected_path(&value,"executablePath",&install.join("Umalytics.exe"))?;
        let data=PathBuf::from(field(&value,"dataDirectory")?);regular_path(&data)?;
        if !crate::storage_paths::approved_data(&data,&install){return bad("Update data is outside this user's approved app folder.");}
        let folder=data.join("cache/update");regular_path(&folder)?;
        if !path_equal(transaction,&folder.join("transaction.json")){return bad("Update transaction is outside its staging directory.");}
        let own=std::env::current_exe().map_err(|_|"Could not locate the update helper.")?;
        regular_path(&own)?;
        if !path_equal(&own,&folder.join("helper.exe")){return bad("Update helper must run from this installation's staging directory.");}
        let stage=PathBuf::from(field(&value,"stagedExecutable")?);
        regular_path(stage.parent().ok_or("Staged release path is invalid.")?)?;
        if stage.file_name()!=Some(std::ffi::OsStr::new("Umalytics.exe"))||!path_equal(stage.parent().unwrap(),&folder){return bad("Staged release is outside its approved directory.");}
        if stage.exists(){regular_path(&stage)?;}else if !recovery{return bad("Staged release is unavailable.");}
        let metadata=expected_path(&value,"manifestPath",&folder.join("release-manifest.json"))?;
        let signature=expected_path(&value,"signaturePath",&folder.join("release-manifest.sig"))?;
        let raw=read_small(&metadata,16384)?;
        let signature=read_small(&signature,256)?;
        let signature=STANDARD.decode(std::str::from_utf8(&signature).map_err(|_|"Release signature is invalid.")?.trim()).map_err(|_|"Release signature is invalid.")?;
        let signature=Signature::from_slice(&signature).map_err(|_|"Release signature is invalid.")?;
        VerifyingKey::from_bytes(key).map_err(|_|"Release verification key is invalid.")?.verify_strict(&raw,&signature).map_err(|_|"Release signature verification failed.")?;
        let manifest:Value=serde_json::from_slice(&raw).map_err(|_|"Signed release metadata is invalid.")?;
        if !exact_keys(&manifest,&["schemaVersion","version","buildNumber","commit","filename","bytes","sha256","dataSha256","releaseUrl"]){return bad("Signed release metadata schema is unsupported.");}
        let number=manifest["buildNumber"].as_u64().ok_or("Signed release build is invalid.")?;
        let version=field(&manifest,"version")?;
        let size=manifest["bytes"].as_u64().ok_or("Signed release size is invalid.")?;
        if manifest["schemaVersion"].as_u64()!=Some(1)||number==0||number>2147483647||version!=format!("0.2.{number}")||field(&manifest,"filename")?!="Umalytics.exe"||size==0||size>MAX_EXE||!is_hex(field(&manifest,"commit")?,40)||!is_hex(field(&manifest,"sha256")?,64)||!is_hex(field(&manifest,"dataSha256")?,64)||field(&manifest,"releaseUrl")?!=format!("{REPO}/releases/tag/v{version}"){return bad("Signed release fields are invalid.");}
        let previous=field(&value,"previousVersion")?.to_owned();
        if build(&previous).is_none_or(|old|old>=number)||field(&value,"version")?!=version{return bad("The update does not advance this installation's version.");}
        let old_hash=field(&value,"expectedOldExeSha256")?.to_owned();let token=field(&value,"token")?.to_owned();
        let installed_hash=digest(&exe)?;
        let helper_hash=digest(&own)?;
        if !is_hex(&old_hash,64)||!is_hex(&token,64)||(helper_hash!=old_hash&&(!recovery||helper_hash!=installed_hash))||installed_hash!=old_hash&&(!recovery||installed_hash!=field(&manifest,"sha256")?){return bad("The installed application or helper changed during update preparation.");}
        if stage.exists()&&(fs::metadata(&stage).map_err(|_|"Staged release is unavailable.")?.len()!=size||digest(&stage)?!=field(&manifest,"sha256")?){return bad("Staged release does not match its signed hash and size.");}
        let backup=folder.join("backup");if backup.exists(){safe_tree(&backup)?;if !recovery{return bad("An earlier update backup needs recovery before another update can start.");}}else if recovery{return bad("The pending update backup is unavailable.");}
        for path in [data.join("data"),data.join("runtime")]{if path.exists(){safe_tree(&path)?;}}
        Ok(Self{install,exe,data,folder,stage,backup,manifest,token,previous,old_hash})
    }
    fn owns(&self,health:&Value)->bool{health["app"]=="UmaTrace"&&health["ok"]==true&&health["dataDirectory"].as_str().is_some_and(|path|path_equal(Path::new(path),&self.data))}
    fn idle(&self,health:&Value)->bool{health["proxy"]["activeGameConnections"].as_u64()==Some(0)&&health["proxy"]["gameConnected"].as_bool()!=Some(true)}
    fn verify_runtime(&self,health:&Value)->Result<(),String>{
        let path=PathBuf::from(field(health,"runtimeExecutable")?);let hash=field(health,"runtimeBuildSha256")?;
        if !is_hex(hash,64){return bad("The updated collector did not report its runtime identity.");}
        regular_path(&path)?;
        if !path_equal(&path,&self.data.join("runtime/UmalyticsCollector.exe"))||digest(&path)?!=hash{return bad("The updated collector runtime does not match its reported build.");}Ok(())
    }
}

fn launch(exe:&Path,install:&Path)->Result<Child,String>{
    let mut command=Command::new(exe);command.current_dir(install).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    // A replacement or rollback app must own its frozen collector extraction,
    // even when this helper inherited the previous collector's _PYI state.
    command.env("PYINSTALLER_RESET_ENVIRONMENT","1");
    #[cfg(windows)]command.creation_flags(0x08000000);
    command.spawn().map_err(|_|"Could not restart the portable application.".into())
}
struct UpdateLock{file:Option<fs::File>,path:PathBuf}
impl Drop for UpdateLock{fn drop(&mut self){self.file.take();let _=fs::remove_file(&self.path);}}
fn update_lock(folder:&Path)->Result<UpdateLock,String>{
    regular_path(folder)?;let path=folder.join("apply.lock");if path.exists(){regular_path(&path)?;}
    let mut options=fs::OpenOptions::new();options.read(true).write(true).create(true);
    #[cfg(windows)]options.share_mode(0);
    let file=options.open(&path).map_err(|_|"An update helper is already running.")?;
    #[cfg(unix)]{
        use std::os::fd::AsRawFd;
        unsafe extern "C"{fn flock(fd:i32,operation:i32)->i32;}
        if unsafe{flock(file.as_raw_fd(),2|4)}!=0{return bad("An update helper is already running.");}
    }
    Ok(UpdateLock{file:Some(file),path})
}
fn replace_executable(target:&Path,replacement:&Path,backup:&Path)->Result<(),String>{
    if backup.exists(){return bad("An update replacement backup already exists.");}
    #[cfg(windows)]{
        use std::os::windows::ffi::OsStrExt;
        #[link(name="kernel32")]unsafe extern "system"{fn ReplaceFileW(target:*const u16,replacement:*const u16,backup:*const u16,flags:u32,exclude:*mut std::ffi::c_void,reserved:*mut std::ffi::c_void)->i32;}
        // AppData and the downloaded EXE can be on different drives. Windows
        // requires the replacement on the target volume; only this temporary
        // swap file lives beside the EXE. Recovery stays in AppData.
        let stamp=std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_|"System clock is unavailable.")?.as_nanos();
        let local=target.with_file_name(format!(".Umalytics-swap-{}-{stamp}.partial",std::process::id()));
        let mut output=fs::OpenOptions::new().write(true).create_new(true).open(&local).map_err(|_|"The app's folder must be writable to install updates.")?;
        let copy_result=(||{
            let mut source=fs::File::open(replacement).map_err(|_|"Could not read the replacement executable.")?;
            std::io::copy(&mut source,&mut output).map_err(|_|"Could not prepare the executable replacement.")?;
            output.sync_all().map_err(|_|"Could not finish writing the executable replacement.")?;drop(output);
            if digest(&local)?!=digest(replacement)?{return bad("The executable copy failed verification.");}
            let mut old=fs::File::open(target).map_err(|_|"Could not read the previous executable.")?;
            let mut saved=fs::OpenOptions::new().write(true).create_new(true).open(backup).map_err(|_|"Could not create the rollback executable.")?;
            if std::io::copy(&mut old,&mut saved).and_then(|_|saved.sync_all()).is_err(){drop(saved);let _=fs::remove_file(backup);return bad("Could not finish the rollback copy.");}
            drop(saved);if digest(backup)?!=digest(target)?{let _=fs::remove_file(backup);return bad("The rollback copy failed verification.");}Ok(())
        })();
        if let Err(error)=copy_result{let _=fs::remove_file(&local);return Err(error);}
        let target:Vec<u16>=target.as_os_str().encode_wide().chain(Some(0)).collect();
        let local_wide:Vec<u16>=local.as_os_str().encode_wide().chain(Some(0)).collect();
        let deadline=Instant::now()+Duration::from_secs(20);
        loop{if unsafe{ReplaceFileW(target.as_ptr(),local_wide.as_ptr(),std::ptr::null(),2,std::ptr::null_mut(),std::ptr::null_mut())}!=0{let _=fs::remove_file(replacement);return Ok(());}if Instant::now()>=deadline{let _=fs::remove_file(local);return bad("Windows could not atomically replace the application. Its previous executable is preserved.");}thread::sleep(Duration::from_millis(200));}
    }
    #[cfg(not(windows))]{move_retry(target,backup)?;if let Err(error)=move_retry(replacement,target){let _=move_retry(backup,target);return Err(error);}Ok(())}
}
fn abort_restart(plan:&Plan,endpoint:&ServiceEndpoint){
    if let Some(health)=endpoint.health(){if plan.owns(&health){let _=endpoint.request("POST","/api/update/abort",Some(&json!({"token":plan.token}).to_string()),health["csrfToken"].as_str());}}
}
fn wait_app_exit(exe:&Path)->Result<(),String>{
    // The native app observes phase=restarting before its collector is stopped.
    #[cfg(windows)]{
        let deadline=Instant::now()+Duration::from_secs(25);
        loop{if fs::OpenOptions::new().access_mode(0x80000000|0x10000).share_mode(0).open(exe).is_ok(){return Ok(());}if Instant::now()>=deadline{return bad("The old application is still open. Its files were left unchanged.");}thread::sleep(Duration::from_millis(200));}
    }
    #[cfg(not(windows))]{let _=exe;thread::sleep(Duration::from_millis(1000));Ok(())}
}
fn wait_service_exit(endpoint:&ServiceEndpoint)->Result<(),String>{
    let deadline=Instant::now()+Duration::from_secs(25);
    while Instant::now()<deadline{if endpoint.health().is_none(){return Ok(());}thread::sleep(Duration::from_millis(200));}bad("The collector did not stop. The old files were left unchanged.")
}
fn stop_owned(plan:&Plan,endpoint:&ServiceEndpoint)->Result<(),String>{
    let health=endpoint.health().ok_or("The collector is unavailable for a safe restart.")?;
    if !plan.owns(&health)||!plan.idle(&health){return bad("The collector is busy or belongs to another installation.");}
    let result=endpoint.request("POST","/api/app/exit",Some("{\"onlyIfIdle\":true}"),health["csrfToken"].as_str());
    if result.is_none_or(|result|result["ok"]!=true){return bad("The collector could not stop safely. Close Uma and try again.");}wait_service_exit(endpoint)
}
fn move_retry(from:&Path,to:&Path)->Result<(),String>{
    let deadline=Instant::now()+Duration::from_secs(20);
    loop{if fs::rename(from,to).is_ok(){return Ok(());}if Instant::now()>=deadline{return bad("An application file is still locked. The update could not replace it.");}thread::sleep(Duration::from_millis(200));}
}
fn remove_tree(path:&Path)->Result<(),String>{if !path.exists(){return Ok(());}safe_tree(path)?;fs::remove_dir_all(path).map_err(|_|"Could not remove an owned temporary update backup.".into())}
fn prepare_journal(plan:&Plan)->Result<Value,String>{
    let mut files=serde_json::Map::new();
    for name in MANAGED{let path=plan.data.join(name);if path.exists(){regular_path(&path)?;if !path.is_file(){return bad("A managed update file is an unexpected directory.");}files.insert((*name).to_owned(),Value::String(digest(&path)?));}}
    Ok(json!({"schemaVersion":1,"oldHash":plan.old_hash,"newHash":plan.manifest["sha256"],"files":files}))
}
fn load_journal(plan:&Plan)->Result<Value,String>{
    let path=plan.backup.join("journal.json");regular_path(&path)?;
    let journal:Value=serde_json::from_slice(&read_small(&path,16384)?).map_err(|_|"Rollback journal is invalid.")?;
    if !exact_keys(&journal,&["schemaVersion","oldHash","newHash","files"])||journal["schemaVersion"]!=1||journal["oldHash"]!=plan.old_hash||journal["newHash"]!=plan.manifest["sha256"]||journal["files"].as_object().is_none_or(|files|files.iter().any(|(name,hash)|!MANAGED.contains(&name.as_str())||hash.as_str().is_none_or(|hash|!is_hex(hash,64)))){return bad("Rollback journal does not match the verified release.");}
    // Backups contain an exact, closed inventory, never arbitrary user files.
    for entry in fs::read_dir(&plan.backup).map_err(|_|"Could not inspect rollback inventory.")?{
        let path=entry.map_err(|_|"Could not inspect rollback inventory.")?.path();
        let name=path.file_name().and_then(|name|name.to_str()).ok_or("Rollback name is invalid.")?;
        if name=="data"||name=="runtime"{if !path.is_dir(){return bad("Rollback inventory is invalid.");}for file in fs::read_dir(&path).map_err(|_|"Could not inspect rollback inventory.")?{let file=file.map_err(|_|"Could not inspect rollback inventory.")?.path();let relative=format!("{name}/{}",file.file_name().and_then(|name|name.to_str()).ok_or("Rollback file is invalid.")?);if !file.is_file()||journal["files"].get(&relative).is_none(){return bad("Unknown rollback files were preserved.");}}}
        else if name!="journal.json"&&name!="Umalytics.exe"{return bad("Unknown rollback files were preserved.");}
    }
    for (name,hash) in journal["files"].as_object().unwrap(){let backup=plan.backup.join(name);if backup.exists()&&digest(&backup)?!=hash.as_str().unwrap(){return bad("A rollback file failed its recorded hash check.");}}
    Ok(journal)
}
fn restore_files(plan:&Plan,journal:&Value)->Result<(),String>{
    // Unknown files and legacy snapshot directories remain where they were.
    // Only the app's fixed managed names can be replaced or removed.
    for name in MANAGED{
        let active=plan.data.join(name);let backup=plan.backup.join(name);
        if backup.exists(){if active.exists(){regular_path(&active)?;if !active.is_file(){return bad("Rollback encountered an unexpected managed directory.");}fs::remove_file(&active).map_err(|_|"A new runtime file is still locked; rollback is preserved.")?;}if let Some(parent)=active.parent(){fs::create_dir_all(parent).map_err(|_|"Could not restore managed folders.")?;}move_retry(&backup,&active)?;}
        else if let Some(hash)=journal["files"].get(*name){if !active.exists()||digest(&active)?!=hash.as_str().unwrap(){return bad("A previous managed file is missing; rollback is preserved.");}}
        else if active.exists(){regular_path(&active)?;if !active.is_file(){return bad("Rollback encountered an unexpected managed directory.");}fs::remove_file(&active).map_err(|_|"A new managed file is still locked; rollback is preserved.")?;}
    }Ok(())
}
fn restore_exe(plan:&Plan)->Result<(),String>{
    let old=plan.backup.join("Umalytics.exe");
    if old.exists(){if digest(&old)?!=plan.old_hash{return bad("The previous application failed its rollback hash check.");}regular_path(&plan.exe)?;let failed=plan.folder.join("failed.exe");if failed.exists(){regular_path(&failed)?;fs::remove_file(&failed).map_err(|_|"An earlier failed executable is still locked.")?;}replace_executable(&plan.exe,&old,&failed)?;let _=fs::remove_file(failed);}
    else if digest(&plan.exe)?!=plan.old_hash{return bad("The previous application backup is missing.");}Ok(())
}
fn record_success(plan:&Plan,version:&Value,hash:&Value)->Result<(),String>{
    fs::write(plan.folder.join("success.json"),json!({"schemaVersion":1,"version":version,"sha256":hash}).to_string()).map_err(|_|"The app updated, but temporary update cleanup could not be recorded.".to_owned())
}

fn run(plan:&Plan,endpoint:&ServiceEndpoint)->Result<(),String>{
    let health=endpoint.health().ok_or("The collector is unavailable for update authorization.")?;
    if !plan.owns(&health)||!plan.idle(&health)||health["version"]!=plan.previous{return bad("The running installation changed or Uma is active. Try again after closing Uma.");}
    let response=endpoint.request("POST","/api/update/restart",Some(&json!({"token":plan.token}).to_string()),health["csrfToken"].as_str());
    if response.is_none_or(|response|response["phase"]!="restarting"){return bad("The running application refused update authorization.");}
    if let Err(error)=wait_app_exit(&plan.exe){abort_restart(plan,endpoint);let _=launch(&plan.exe,&plan.install);return Err(error);}
    if let Err(error)=stop_owned(plan,endpoint){abort_restart(plan,endpoint);let _=launch(&plan.exe,&plan.install);return Err(error);}
    // Recheck after the shutdown interval so a changed staged file is never run.
    let preparation=(||{
        regular_path(&plan.exe)?;regular_path(&plan.stage)?;
        if digest(&plan.exe)?!=plan.old_hash||digest(&plan.stage)?!=field(&plan.manifest,"sha256")?{return bad("An update executable changed before replacement.");}
        fs::create_dir(&plan.backup).map_err(|_|"Could not create the temporary rollback directory.".to_owned())
    })();
    if let Err(error)=preparation{let _=launch(&plan.exe,&plan.install);return Err(error);}
    let journal=match prepare_journal(plan){Ok(journal)=>journal,Err(error)=>{let _=fs::remove_dir(&plan.backup);let _=launch(&plan.exe,&plan.install);return Err(error);}};
    if fs::write(plan.backup.join("journal.json"),journal.to_string()).is_err(){let _=fs::remove_dir(&plan.backup);let _=launch(&plan.exe,&plan.install);return bad("Could not prepare the rollback journal. The current app was restarted.");}
    let mut child:Option<Child>=None;
    let result=(||{
        // Move only managed program/reference files. Races, settings, exports,
        // capture certificates and the WebView profile are never backup targets.
        for name in journal["files"].as_object().unwrap().keys(){let target=plan.backup.join(name);fs::create_dir_all(target.parent().unwrap()).map_err(|_|"Could not prepare managed rollback folders.")?;move_retry(&plan.data.join(name),&target)?;}
        replace_executable(&plan.exe,&plan.stage,&plan.backup.join("Umalytics.exe"))?;
        if digest(&plan.exe)?!=field(&plan.manifest,"sha256")?{return bad("Installed release failed its signed hash check.");}
        child=Some(launch(&plan.exe,&plan.install)?);
        let deadline=Instant::now()+Duration::from_secs(60);
        while Instant::now()<deadline{
            if let Some(health)=endpoint.health(){
                if !plan.owns(&health){return bad("Another installation answered during update verification.");}
                if health["version"]!=plan.manifest["version"]||health["dataSha256"]!=plan.manifest["dataSha256"]{return bad("The restarted application version or reference data differs from the signed release.");}
                if health["staticReady"]!=true{thread::sleep(Duration::from_millis(250));continue;}
                let settings=endpoint.request("GET","/api/settings",None,None).ok_or("Updated settings are unavailable.")?;
                if settings["collectionEnabled"]==true&&health["proxy"]["listening"]!=true{thread::sleep(Duration::from_millis(250));continue;}
                {
                    plan.verify_runtime(&health)?;
                    let data=endpoint.request("GET","/api/data/status",None,None).ok_or("Updated reference data is unavailable.")?;
                    if data["manifestSha256"]!=plan.manifest["dataSha256"]{return bad("Updated reference data does not match the signed release.");}
                    return Ok(());
                }
            }
            if child.as_mut().is_some_and(|child|matches!(child.try_wait(),Ok(Some(_)))){return bad("The updated application exited before becoming ready.");}
            thread::sleep(Duration::from_millis(250));
        }bad("The updated application did not become healthy in time.")
    })();
    if let Err(reason)=result{
        if endpoint.health().is_some(){if stop_owned(plan,endpoint).is_err(){return Err(format!("{reason} Rollback is saved in cache/update/backup; close Uma before recovery."));}}
        if let Some(child)=child.as_mut(){let _=child.kill();let _=child.wait();}
        let journal=load_journal(plan)?;restore_files(plan,&journal)?;restore_exe(plan)?;
        remove_tree(&plan.backup)?;record_success(plan,&Value::String(plan.previous.clone()),&Value::String(plan.old_hash.clone()))?;
        let _=launch(&plan.exe,&plan.install);
        return Err(format!("{reason} The previous application and reference data were restored."));
    }
    // A later normal startup may remove the running helper and metadata. The
    // success marker is created only AFTER all release identity checks pass.
    record_success(plan,&plan.manifest["version"],&plan.manifest["sha256"])?;
    remove_tree(&plan.backup)?;
    Ok(())
}

fn compiled_key()->Result<[u8;32],String>{
    let decoded=(0..32).map(|index|u8::from_str_radix(KEY.trim().get(index*2..index*2+2).unwrap_or(""),16)).collect::<Result<Vec<_>,_>>().map_err(|_|"Bundled release verification key is invalid.")?;
    let key:[u8;32]=decoded.try_into().map_err(|_|"Bundled release verification key is invalid.")?;
    Ok(key)
}
pub fn apply(transaction:&Path)->Result<(),String>{
    apply_verified(transaction,&compiled_key()?,4317)
}

// Functional harnesses supply a synthetic signing key and an isolated loopback
// port. The shipped CLI always calls apply(), which pins both at compile time.
pub(crate) fn apply_verified(transaction:&Path,key:&[u8;32],port:u16)->Result<(),String>{
    let plan=Plan::load(transaction,key,false)?;
    let _lock=update_lock(&plan.folder)?;
    let result=run(&plan,&ServiceEndpoint{port});
    if let Err(error)=&result{let _=fs::write(plan.folder.join("helper-error.txt"),error);}
    result
}

/// Normal startup calls this before opening/extracting any managed runtime.
/// An exclusive helper lock makes the new app skip recovery during a live swap.
pub fn recover_pending(data:&Path)->Result<bool,String>{
    let own=std::env::current_exe().map_err(|_|"Could not locate the app for update recovery.")?;
    let install=own.parent().ok_or("Portable installation is unavailable.")?;
    if !crate::storage_paths::approved_data(data,install){return Ok(false);}
    let folder=data.join("cache/update");let backup=folder.join("backup");
    if !backup.exists(){return Ok(false);}regular_path(&folder)?;safe_tree(&backup)?;
    let transaction=folder.join("transaction.json");regular_path(&transaction)?;
    let lock=match update_lock(&folder){Ok(lock)=>lock,Err(_)=>return Ok(false)};
    // Use the presently running trusted app as the recovery helper; never run
    // an arbitrary stale executable merely because it sits beside a journal.
    let helper=folder.join("helper.exe");if helper.exists(){regular_path(&helper)?;}
    let temporary=folder.join("recovery-helper.partial");if temporary.exists(){regular_path(&temporary)?;fs::remove_file(&temporary).map_err(|_|"Could not prepare a recovery helper.")?;}
    fs::copy(&own,&temporary).map_err(|_|"Could not copy the trusted recovery helper.")?;
    if helper.exists(){fs::remove_file(&helper).map_err(|_|"The previous helper is still running.")?;}
    fs::rename(&temporary,&helper).map_err(|_|"Could not finish recovery helper preparation.")?;
    drop(lock);
    let mut command=Command::new(helper);command.arg("--rollback-update").arg(transaction).current_dir(install).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    command.env("PYINSTALLER_RESET_ENVIRONMENT","1");
    #[cfg(windows)]command.creation_flags(0x08000000);
    command.spawn().map_err(|_|"Could not start the pending update recovery.")?;Ok(true)
}
pub fn rollback(transaction:&Path)->Result<(),String>{rollback_verified(transaction,&compiled_key()?,4317)}
pub(crate) fn rollback_verified(transaction:&Path,key:&[u8;32],port:u16)->Result<(),String>{
    let plan=Plan::load(transaction,key,true)?;let _lock=update_lock(&plan.folder)?;
    let endpoint=ServiceEndpoint{port};let journal=load_journal(&plan)?;
    let result=(||{
        wait_app_exit(&plan.exe)?;
        if endpoint.health().is_some(){stop_owned(&plan,&endpoint)?;}
        let marker=plan.folder.join("success.json");
        if marker.exists(){regular_path(&marker)?;let receipt:Value=serde_json::from_slice(&read_small(&marker,1024)?).map_err(|_|"Update success receipt is invalid.")?;if receipt["sha256"]==plan.manifest["sha256"]&&digest(&plan.exe)?==field(&plan.manifest,"sha256")?{remove_tree(&plan.backup)?;let _=launch(&plan.exe,&plan.install);return Ok(());}}
        restore_files(&plan,&journal)?;restore_exe(&plan)?;remove_tree(&plan.backup)?;
        record_success(&plan,&Value::String(plan.previous.clone()),&Value::String(plan.old_hash.clone()))?;
        launch(&plan.exe,&plan.install)?;Ok(())
    })();
    if let Err(error)=&result{let _=fs::write(plan.folder.join("helper-error.txt"),error);let _=launch(&plan.exe,&plan.install);}result
}

/// Call after normal startup, never before the service has verified its assets.
pub fn cleanup(data:&Path)->Result<(),String>{
    let own=std::env::current_exe().map_err(|_|"Could not locate the application for update cleanup.")?;
    let install=own.parent().ok_or("Could not resolve portable installation.")?;
    if !crate::storage_paths::approved_data(data,install){return Ok(());}
    let folder=data.join("cache/update");if !folder.exists(){return Ok(());}regular_path(&folder)?;
    let _lock=match update_lock(&folder){Ok(lock)=>lock,Err(_)=>return Ok(())};
    let marker=folder.join("success.json");if !marker.exists(){return Ok(());}regular_path(&marker)?;
    let receipt:Value=serde_json::from_slice(&read_small(&marker,1024)?).map_err(|_|"Update cleanup receipt is invalid.")?;
    if !exact_keys(&receipt,&["schemaVersion","version","sha256"])||receipt["schemaVersion"]!=1||!is_hex(field(&receipt,"sha256")?,64)||digest(&own)?!=field(&receipt,"sha256")?{return bad("Update cleanup receipt does not match the running application.");}
    // The helper may still be verifying and removing its backup. Let that
    // process finish; the following startup safely removes the remaining files.
    if folder.join("backup").exists(){return Ok(());}
    let mut removed=true;
    for name in ["helper.exe","transaction.json","release-manifest.json","release-manifest.sig","helper-error.txt","Umalytics.exe","Umalytics.exe.partial","recovery-helper.partial","failed.exe"]{
        let path=folder.join(name);if path.exists(){regular_path(&path)?;if path.is_file(){if fs::remove_file(path).is_err(){removed=false;}}else{return bad("Update cleanup found an unexpected directory.");}}
    }
    if removed{let _=fs::remove_file(marker);}Ok(())
}
