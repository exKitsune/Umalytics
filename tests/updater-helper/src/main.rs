use std::{path::Path, process::{Command, Stdio}};
#[path="../../../src-tauri/src/service_startup.rs"]mod service_startup;
#[path="../../../src-tauri/src/updater.rs"]mod updater;
#[path="../../../src-tauri/src/storage_paths.rs"]mod storage_paths;
#[cfg(windows)]use std::os::windows::process::CommandExt;
fn main(){
    let arguments:Vec<String>=std::env::args().skip(1).collect();
    if arguments.first().is_some_and(|arg|arg=="--hold-desktop-fixture"){
        let folder=Path::new(&arguments[1]);std::fs::write(folder.join("old-ready"),"running").unwrap();
        while !folder.join("old-exit").exists(){std::thread::sleep(std::time::Duration::from_millis(25));}return;
    }
    if arguments.first().is_some_and(|arg|arg=="--replacement-wait-fixture"){
        updater::wait_replacement_turn(Path::new(&arguments[1])).unwrap();
        std::fs::write(Path::new(&arguments[1]).join("replacement-ready"),"ready").unwrap();return;
    }
    if arguments.first().is_some_and(|arg|arg=="--old-desktop-fixture"){
        let install=std::path::PathBuf::from(std::env::var("UMALYTICS_WORKFLOW_INSTALL").unwrap());
        let endpoint=service_startup::ServiceEndpoint{port:std::env::var("UMALYTICS_WORKFLOW_PORT").unwrap().parse().unwrap()};
        std::fs::write(install.join("old-desktop-ready.txt"),"running").unwrap();
        loop{
            if endpoint.health().is_some_and(|h|h["update"]["phase"]=="restarting"){
                std::thread::sleep(std::time::Duration::from_millis(1600));
                use std::io::Write;
                writeln!(std::fs::OpenOptions::new().append(true).create(true).open(install.join("events.txt")).unwrap(),"old-desktop-exited").unwrap();
                return;
            }
            std::thread::sleep(std::time::Duration::from_millis(25));
        }
    }
    if arguments.first().is_some_and(|arg|arg=="--migrate-storage") {
        let result = (|| { let target=storage_paths::user_data()?; let _lock=storage_paths::lock(&target)?;
            storage_paths::migrate_once(Path::new(&arguments[1]),&target)?; Ok::<_,String>(target) })();
        println!("{}",serde_json::json!({"ok":result.is_ok(),"path":result.as_ref().ok(),"error":result.err()}));return;
    }
    if arguments.first().is_some_and(|arg|arg=="--apply-update"||arg=="--rollback-update"){
        let key:Vec<u8>=(0..32).map(|i|u8::from_str_radix(&arguments[2][i*2..i*2+2],16).unwrap()).collect();
        let key=key.try_into().unwrap();let port=arguments[3].parse().unwrap();
        let result=if arguments[0]=="--rollback-update"{updater::rollback_verified(Path::new(&arguments[1]),&key,port)}else{updater::apply_verified(Path::new(&arguments[1]),&key,port)};
        println!("{}",serde_json::json!({"ok":result.is_ok(),"error":result.err()}));return;
    }
    if arguments.first().is_some_and(|arg|arg=="--cleanup"){
        let result=updater::cleanup(Path::new(&arguments[1]));println!("{}",serde_json::json!({"ok":result.is_ok(),"error":result.err()}));return;
    }
    if arguments.first().is_some_and(|arg|arg=="--recover-pending"){
        let result=updater::recover_pending(Path::new(&arguments[1]));println!("{}",serde_json::json!({"ok":result.is_ok(),"recovery":result.as_ref().ok(),"error":result.err()}));return;
    }
    // A real executable replacement starts this process. Its embedded trailer
    // identifies the synthetic app version; the process owns a live collector.
    let own=std::env::current_exe().unwrap();let bytes=std::fs::read(own).unwrap();
    let marker=b"UMALYTICS-WORKFLOW-VERSION=";
    let index=bytes.windows(marker.len()).rposition(|part|part==marker).unwrap()+marker.len();
    let version=std::str::from_utf8(&bytes[index..]).unwrap().trim();
    let payload:serde_json::Value=serde_json::from_str(version).unwrap();
    let endpoint=service_startup::ServiceEndpoint{port:std::env::var("UMALYTICS_WORKFLOW_PORT").unwrap().parse().unwrap()};
    // A native relaunch reuses the still-running owned collector after an
    // aborted restart, rather than creating a competing second collector.
    if endpoint.health().is_some(){let _=std::fs::write(Path::new(&std::env::var("UMALYTICS_WORKFLOW_INSTALL").unwrap()).join("app-attached.txt"),"owned collector reused");while endpoint.health().is_some(){std::thread::sleep(std::time::Duration::from_millis(100));}return;}
    let mut command=Command::new(std::env::var("UMALYTICS_WORKFLOW_PYTHON").unwrap());
    command.arg(std::env::var("UMALYTICS_WORKFLOW_SCRIPT").unwrap()).arg("--owned-service").arg(version)
        .arg(std::env::var("UMALYTICS_WORKFLOW_INSTALL").unwrap()).arg(std::env::var("UMALYTICS_WORKFLOW_PORT").unwrap())
        .stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    #[cfg(windows)]command.creation_flags(0x08000000);
    let mut service=command.spawn().unwrap();
    while endpoint.health().is_none(){if service.try_wait().unwrap().is_some(){return;}std::thread::sleep(std::time::Duration::from_millis(25));}
    if payload["desktopExit"]==true{return;}
    if let Some(delay)=payload["desktopDelay"].as_f64(){std::thread::sleep(std::time::Duration::from_secs_f64(delay));}
    updater::desktop_ready(Path::new(&std::env::var("UMALYTICS_WORKFLOW_DATA").unwrap())).unwrap();
    let _=service.wait();
}
