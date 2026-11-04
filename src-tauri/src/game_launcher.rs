//! Steam child lifetime and proxy environment, without a second frozen runtime.
use std::{path::Path,process::{Command,Stdio},thread,time::{Duration,Instant}};
use crate::service_startup::ServiceEndpoint;
#[cfg(windows)]use std::os::windows::process::CommandExt;

struct Registration<'a>{endpoint:&'a ServiceEndpoint,token:String}
impl Drop for Registration<'_>{fn drop(&mut self){
    let body=serde_json::json!({"pid":std::process::id(),"active":false}).to_string();
    let _=self.endpoint.request("POST","/api/game/launch-state",Some(&body),Some(&self.token));
}}

pub fn launch(arguments:&[String],endpoint:&ServiceEndpoint,runtime:&Path,data:&Path,digest:&str)->Result<i32,String>{
    let index=arguments.iter().position(|s|s.to_lowercase().ends_with(".exe")&&Path::new(s).is_file()).ok_or("The game executable must follow --launch-game --.")?;
    let executable=std::fs::canonicalize(&arguments[index]).map_err(|_|"The game executable is unavailable.")?;
    let deadline=Instant::now()+Duration::from_secs(10);
    let status=loop{
        if let Some(status)=endpoint.health(){
            if !ServiceEndpoint::matches_instance(&status,runtime,data)||status["runtimeBuildSha256"].as_str()!=Some(digest){
                return Err("Another Umalytics runtime is holding the capture port. Exit it from the tray, then launch again.".into());
            }
            if status["proxy"]["running"]==true&&status["proxy"]["state"]=="running"{break status;}
        }
        if Instant::now()>=deadline{return Err("Capture did not start. Exit Umalytics from the tray and try again.".into());}
        thread::sleep(Duration::from_millis(50));
    };
    let port=status["proxy"]["port"].as_u64().filter(|p|*p>0&&*p<=65535).ok_or("Capture reported an invalid proxy port.")?;
    let token=status["csrfToken"].as_str().ok_or("Capture did not provide its local authorization token.")?;
    let body=serde_json::json!({"pid":std::process::id(),"active":true}).to_string();
    if endpoint.request("POST","/api/game/launch-state",Some(&body),Some(token)).is_none_or(|v|v["ok"]!=true){
        return Err("Capture rejected this launcher. Exit Umalytics from the tray and launch again.".into());
    }
    let _registration=Registration{endpoint,token:token.to_owned()};
    let mut command=Command::new(&executable);
    command.args(&arguments[index+1..]).current_dir(executable.parent().unwrap()).stdin(Stdio::null()).stdout(Stdio::null()).stderr(Stdio::null());
    for (name,_) in std::env::vars_os(){
        if matches!(name.to_string_lossy().to_ascii_lowercase().as_str(),"http_proxy"|"https_proxy"|"all_proxy"|"no_proxy"|"sslkeylogfile"){
            command.env_remove(name);
        }
    }
    for name in ["http_proxy","https_proxy","all_proxy"]{command.env(name,format!("http://127.0.0.1:{port}"));}
    command.env("no_proxy","localhost,127.0.0.1,::1");
    #[cfg(windows)]command.creation_flags(0x08000000);
    let mut child=command.spawn().map_err(|_|"Windows could not start the game.")?;
    crate::diagnostics::event("game_spawned");
    child.wait().map(|s|s.code().unwrap_or(1)).map_err(|_|"Could not wait for the game process.".into())
}
