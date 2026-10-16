use std::{cell::Cell, path::PathBuf, process::{Command, Stdio}};
#[cfg(windows)]
use std::os::windows::process::CommandExt;
#[path = "../../../src-tauri/src/service_startup.rs"]
mod service_startup;

fn main() {
    let args: Vec<String> = std::env::args().skip(1).collect();
    let endpoint = service_startup::ServiceEndpoint { port: args[0].parse().unwrap() };
    let runtime = PathBuf::from(&args[1]);
    let data = PathBuf::from(&args[2]);
    let launched = Cell::new(false);
    let result = endpoint.ensure_service(&runtime, &data, || {
        let mut command = Command::new(&runtime);
        command.args(&args[3..]).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
        #[cfg(windows)]
        command.creation_flags(0x08000000);
        command.spawn().map_err(|_| "Could not start the real test runtime.")?;
        launched.set(true);
        Ok(())
    });
    println!("{}", serde_json::json!({"ok":result.is_ok(),"launched":launched.get(),"error":result.err()}));
}
