use std::{fs, io::{Read, Write}, net::TcpStream, path::Path, thread, time::Duration};

pub struct ServiceEndpoint { pub port: u16 }

impl ServiceEndpoint {
    pub fn request(&self, method: &str, path: &str, body: Option<&str>, token: Option<&str>) -> Option<serde_json::Value> {
        let mut stream = TcpStream::connect_timeout(&format!("127.0.0.1:{}", self.port).parse().ok()?, Duration::from_millis(300)).ok()?;
        stream.set_read_timeout(Some(Duration::from_secs(2))).ok()?;
        stream.set_write_timeout(Some(Duration::from_secs(2))).ok()?;
        let payload = body.unwrap_or("");
        let mut headers = format!("{} {} HTTP/1.1\r\nHost: 127.0.0.1:{}\r\nConnection: close\r\n", method, path, self.port);
        if method == "POST" {
            headers.push_str(&format!("Origin: http://127.0.0.1:{}\r\nX-UmaTrace-CSRF: {}\r\nContent-Type: application/json\r\nContent-Length: {}\r\n", self.port, token?, payload.len()));
        }
        headers.push_str("\r\n");
        stream.write_all(headers.as_bytes()).ok()?;
        stream.write_all(payload.as_bytes()).ok()?;
        let mut raw = String::new();
        stream.take(1024 * 1024).read_to_string(&mut raw).ok()?;
        let (head, json) = raw.split_once("\r\n\r\n")?;
        if !head.starts_with("HTTP/1.1 200") { return None; }
        serde_json::from_str(json).ok()
    }

    pub fn health(&self) -> Option<serde_json::Value> {
        let result = self.request("GET", "/api/health", None, None)?;
        if result["app"] == "UmaTrace" && result["ok"] == true { Some(result) } else { None }
    }

    pub fn listening(&self) -> bool {
        TcpStream::connect_timeout(&format!("127.0.0.1:{}", self.port).parse().unwrap(), Duration::from_millis(300)).is_ok()
    }

    fn matching_data(status: &serde_json::Value, data: &Path) -> bool {
        status["dataDirectory"].as_str().is_some_and(|saved| same_path(saved, data))
    }

    fn matching_runtime(status: &serde_json::Value, runtime: &Path) -> bool {
        status["runtimeExecutable"].as_str().is_some_and(|saved| same_path(saved, runtime))
    }

    fn matching_build(status: &serde_json::Value, runtime: &Path, digest: Option<&str>) -> bool {
        Self::matching_runtime(status, runtime)
            && digest.is_none_or(|expected| status["runtimeBuildSha256"].as_str() == Some(expected))
    }

    pub fn matches_instance(status: &serde_json::Value, runtime: &Path, data: &Path) -> bool {
        Self::matching_data(status, data) && Self::matching_runtime(status, runtime)
    }

    fn idle(status: &serde_json::Value) -> bool {
        let proxy = &status["proxy"];
        proxy["activeGameConnections"].as_u64() == Some(0) && proxy["gameConnected"].as_bool() != Some(true)
            && (proxy["running"].as_bool() == Some(false) || proxy["listening"].as_bool() == Some(true))
    }

    pub fn stop_for_migration(&self, data: &Path) -> Result<(), String> {
        if let Some(status) = self.health() {
            if !Self::matching_data(&status, data) {
                return Err("Close the other Umalytics app before moving this data.".into());
            }
            if !Self::idle(&status) { return Err("Close the game, then reopen Umalytics to move its data.".into()); }
            let stopped = self.request("POST", "/api/app/exit", Some("{\"onlyIfIdle\":true}"), status["csrfToken"].as_str());
            if stopped.is_none_or(|value| value["ok"] != true) { return Err("The collector could not stop safely. Your data is unchanged.".into()); }
            for _ in 0..100 {
                if !self.listening() {
                    // Give the old tray and browser profile time to close too.
                    thread::sleep(Duration::from_secs(2)); return Ok(());
                }
                thread::sleep(Duration::from_millis(200));
            }
            return Err("The old collector is still closing. Reopen Umalytics shortly.".into());
        }
        if self.listening() { return Err("The collector port is busy. Close the other app before migration.".into()); }
        Ok(())
    }

    /// Reuse only this installation's exact runtime. Legacy health responses
    /// without runtime identity can hand off after ownership and idle checks.
    /// The supplied launcher starts a real runtime; it is never called on a
    /// foreign service, active capture, unrecognized listener or failed stop.
    pub fn ensure_service<F>(&self, runtime: &Path, data: &Path, launch: F) -> Result<(), String>
    where F: FnOnce() -> Result<(), String> {
        self.ensure_service_build(runtime, data, None, launch)
    }

    pub fn ensure_service_build<F>(&self, runtime: &Path, data: &Path, digest: Option<&str>, launch: F) -> Result<(), String>
    where F: FnOnce() -> Result<(), String> {
        if let Some(status) = self.health() {
            if !Self::matching_data(&status, data) {
                return Err("Another Umalytics installation is running. Close that app before opening this one.".into());
            }
            if Self::matching_build(&status, runtime, digest) { return Ok(()); }
            if status.get("runtimeExecutable").is_some() && status["runtimeExecutable"].as_str().is_none() {
                return Err("The running collector's version could not be verified. Close it and reopen Umalytics.".into());
            }
            if !Self::idle(&status) {
                return Err("Close the game, then reopen Umalytics to finish the update. Capture is still running.".into());
            }
            // Recheck immediately before handoff. New services also check
            // onlyIfIdle at the exit endpoint; older versions ignore that flag.
            let current = self.health().ok_or("The running collector changed. Reopen Umalytics to retry.")?;
            if !Self::matching_data(&current, data) {
                return Err("Another Umalytics installation is running. Close that app before opening this one.".into());
            }
            if Self::matching_build(&current, runtime, digest) { return Ok(()); }
            if current.get("runtimeExecutable").is_some() && current["runtimeExecutable"].as_str().is_none() {
                return Err("The running collector's version could not be verified. Close it and reopen Umalytics.".into());
            }
            if !Self::idle(&current) {
                return Err("Close the game, then reopen Umalytics to finish the update. Capture is still running.".into());
            }
            let stopped = self.request("POST", "/api/app/exit", Some("{\"onlyIfIdle\":true}"), current["csrfToken"].as_str());
            if stopped.as_ref().is_none_or(|result| result["ok"] != true) {
                return Err("Could not stop the older collector safely. Close the game and collector, then reopen Umalytics.".into());
            }
            for _ in 0..80 {
                if !self.listening() { break; }
                thread::sleep(Duration::from_millis(250));
            }
            if self.listening() {
                return Err("The older collector has not closed yet. Reopen Umalytics after it exits.".into());
            }
        } else if self.listening() {
            return Err(format!("Port {} is used by another program. Close that program before opening Umalytics.", self.port));
        }
        launch()?;
        for _ in 0..120 {
            if let Some(status) = self.health() {
                if Self::matching_data(&status, data) && Self::matching_build(&status, runtime, digest) { return Ok(()); }
                return Err("A different collector answered during startup. Reopen Umalytics after closing that app.".into());
            }
            thread::sleep(Duration::from_millis(250));
        }
        Err("Collection could not start. Restart Umalytics and try again.".into())
    }
}

fn same_path(saved: &str, expected: &Path) -> bool {
    let (Ok(saved), Ok(expected)) = (fs::canonicalize(saved), fs::canonicalize(expected)) else { return false; };
    #[cfg(windows)]
    { saved.to_string_lossy().eq_ignore_ascii_case(&expected.to_string_lossy()) }
    #[cfg(not(windows))]
    { saved == expected }
}
