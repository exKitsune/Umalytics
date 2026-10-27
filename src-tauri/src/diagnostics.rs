//! Local lifecycle records, deliberately excluding command lines and error text.
use std::{fs, io::{self, Write}, path::{Path, PathBuf}, sync::{Mutex, OnceLock}, time::{SystemTime, UNIX_EPOCH}};
use serde_json::json;

const MAX_BYTES: u64 = 1024 * 1024;
const MAX_FILES: usize = 12;
static LOG: OnceLock<Mutex<Log>> = OnceLock::new();

struct Log {
    directory: PathBuf,
    role: &'static str,
    session: String,
    segment: u32,
}

fn milliseconds() -> u128 { SystemTime::now().duration_since(UNIX_EPOCH).unwrap_or_default().as_millis() }

impl Log {
    fn write(&mut self, event: &str, details: serde_json::Value) -> io::Result<()> {
        crate::storage_paths::regular(&self.directory).map_err(io::Error::other)?;
        fs::create_dir_all(&self.directory)?;
        let name = |segment| self.directory.join(format!("{}-{}-{segment:04}.jsonl", self.role, self.session));
        let mut path = name(self.segment);
        crate::storage_paths::regular(&path).map_err(io::Error::other)?;
        let record = json!({"timestampUnixMs": milliseconds(), "pid": std::process::id(),
            "role": self.role, "session": self.session, "event": event,
            "version": env!("CARGO_PKG_VERSION"), "serviceBuildSha256": crate::SERVICE_DIGEST, "details": details});
        let raw = serde_json::to_vec(&record)?;
        if fs::metadata(&path).map(|m| m.len() + raw.len() as u64 + 1 > MAX_BYTES).unwrap_or(false) {
            self.segment += 1;
            path = name(self.segment);
            crate::storage_paths::regular(&path).map_err(io::Error::other)?;
        }
        let fresh = !path.exists();
        let mut stream = fs::OpenOptions::new().create(true).append(true).open(&path)?;
        stream.write_all(&raw)?;
        stream.write_all(b"\n")?;
        stream.flush()?;
        if fresh { self.prune(&path)?; }
        Ok(())
    }

    fn prune(&self, current: &Path) -> io::Result<()> {
        let prefix = format!("{}-", self.role);
        let mut files: Vec<_> = fs::read_dir(&self.directory)?.filter_map(Result::ok).filter_map(|entry| {
            let name = entry.file_name().into_string().ok()?;
            let suffix = name.strip_prefix(&prefix)?.strip_suffix(".jsonl")?;
            let parts: Vec<_> = suffix.split('-').collect();
            if parts.len() != 3 || parts.iter().any(|p| p.is_empty() || !p.bytes().all(|b| b.is_ascii_digit())) { return None; }
            let path = entry.path();
            if path == current || crate::storage_paths::regular(&path).is_err() { return None; }
            let meta = entry.metadata().ok()?;
            if !meta.is_file() { return None; }
            Some((meta.modified().ok()?, path))
        }).collect();
        files.sort_by(|a, b| b.0.cmp(&a.0));
        for (_, path) in files.into_iter().skip(MAX_FILES - 1) { let _ = fs::remove_file(path); }
        Ok(())
    }
}

pub fn initialize(role: &'static str) {
    if let Ok(data) = crate::storage_paths::user_data() {
        let _ = LOG.set(Mutex::new(Log { directory: data.join("logs"), role,
            session: format!("{}-{}", milliseconds(), std::process::id()), segment: 0 }));
    }
    std::panic::set_hook(Box::new(|info| {
        // Panic payloads may include paths or sensitive values. Keep only source location.
        let location = info.location().map(|p| json!({
            "file": Path::new(p.file()).file_name().and_then(|s| s.to_str()), "line": p.line(), "column": p.column()
        }));
        if let Some(log) = LOG.get() {
            // A failure within logging must not recursively deadlock the panic hook.
            if let Ok(mut log) = log.try_lock() { let _ = log.write("rust_panic", json!({"location": location})); }
        }
    }));
    event("process_start");
}

pub fn event(event: &'static str) { detail(event, json!({})); }

pub fn detail(event: &'static str, value: serde_json::Value) {
    if let Some(log) = LOG.get() {
        if let Ok(mut log) = log.lock() { let _ = log.write(event, value); }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn rotation_is_bounded_and_preserves_other_files() {
        let root = std::env::temp_dir().join(format!("umalytics-diagnostics-{}-{}", std::process::id(), milliseconds()));
        fs::create_dir_all(&root).unwrap();
        let path = root.join("desktop-123-1-0000.jsonl");
        fs::write(&path, vec![b' '; MAX_BYTES as usize]).unwrap();
        for n in 0..20 { fs::write(root.join(format!("desktop-100-{n}-0000.jsonl")), b"{}").unwrap(); }
        fs::write(root.join("keep.txt"), b"keep").unwrap();
        let mut log = Log { directory: root.clone(), role: "desktop", session: "123-1".into(), segment: 0 };
        log.write("heartbeat", json!({})).unwrap();
        let saved: serde_json::Value = serde_json::from_slice(&fs::read(root.join("desktop-123-1-0001.jsonl")).unwrap()).unwrap();
        assert_eq!(saved["event"], "heartbeat");
        assert_eq!(fs::read_dir(&root).unwrap().filter_map(Result::ok).count(), MAX_FILES + 1);
        assert_eq!(fs::read(root.join("keep.txt")).unwrap(), b"keep");
        fs::remove_dir_all(root).unwrap();
    }
}
