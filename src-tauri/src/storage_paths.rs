//! Per-user storage and verified migration of the former adjacent data folder.
use std::{collections::BTreeMap, fs, io::Read, path::{Component, Path, PathBuf}, thread, time::{Duration, Instant}};
use sha2::{Digest, Sha256};

pub fn user_data() -> Result<PathBuf, String> {
    let base = std::env::var_os("LOCALAPPDATA").filter(|value| !value.is_empty())
        .map(PathBuf::from).ok_or("Windows could not locate your local AppData folder.")?;
    if !base.is_absolute() { return Err("The local AppData path must be absolute.".into()); }
    Ok(base.join("Umalytics"))
}

// Temporary transition support. Normal AppData users never inspect adjacent
// folders after this receipt is written, including users with a fresh install.
// Remove the migration entry point after the legacy release transition ends.
pub fn initialized(directory: &Path) -> Result<bool, String> {
    let receipt = directory.join("storage-layout.json"); regular(&receipt)?;
    if !receipt.exists() { return Ok(false); }
    let bytes = fs::read(receipt).map_err(|_| "Could not read the storage layout.")?;
    let value: serde_json::Value = serde_json::from_slice(&bytes).map_err(|_| "The storage layout file is invalid.")?;
    if value["schemaVersion"] != 1 || value["legacyMigrationComplete"] != true {
        return Err("The storage layout file is unsupported. Your files are unchanged.".into());
    }
    Ok(true)
}

pub fn migrate_once(source: &Path, destination: &Path) -> Result<(), String> {
    if initialized(destination)? { return Ok(()); }
    migrate(source, destination)?;
    let receipt = destination.join("storage-layout.json"); regular(&receipt)?;
    // No application writes start until this receipt is durable. A failed
    // receipt write is safe to retry: the verified destination already exists.
    use std::io::Write;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "System clock is unavailable.")?.as_nanos();
    let temporary = destination.join(format!(".storage-layout-{stamp}.partial"));
    let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Could not save the storage layout.")?;
    let result = file.write_all(b"{\"schemaVersion\":1,\"legacyMigrationComplete\":true}\n").and_then(|_| file.sync_all());
    drop(file);
    if result.is_err() { let _ = fs::remove_file(temporary); return Err("Could not finish saving the storage layout.".into()); }
    fs::rename(&temporary, receipt).map_err(|_| "Could not finish saving the storage layout.".into())
}

pub fn regular(path: &Path) -> Result<(), String> {
    if !path.is_absolute() || path.components().any(|part| matches!(part, Component::ParentDir)) {
        return Err("Storage paths must be absolute.".into());
    }
    for ancestor in path.ancestors() {
        match fs::symlink_metadata(ancestor) {
            Ok(metadata) => {
                if metadata.file_type().is_symlink() { return Err("Linked storage folders cannot be migrated.".into()); }
                #[cfg(windows)] {
                    use std::os::windows::fs::MetadataExt;
                    if metadata.file_attributes() & 0x400 != 0 { return Err("Linked storage folders cannot be migrated.".into()); }
                }
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {},
            Err(_) => return Err("Could not inspect the storage folder.".into()),
        }
    }
    Ok(())
}

pub fn digest(path: &Path) -> Result<String, String> {
    regular(path)?;
    let mut input = fs::File::open(path).map_err(|_| "Close the older app before moving its data.")?;
    let mut hash = Sha256::new();
    let mut buffer = [0u8; 256 * 1024];
    loop {
        let count = input.read(&mut buffer).map_err(|_| "Could not verify an app data file.")?;
        if count == 0 { break; }
        hash.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hash.finalize()))
}

fn inventory(root: &Path, path: &Path, files: &mut BTreeMap<PathBuf, String>, folders: &mut Vec<PathBuf>) -> Result<(), String> {
    regular(path)?;
    if !path.is_dir() { return Err("The app data folder is not a directory.".into()); }
    folders.push(path.strip_prefix(root).unwrap().to_path_buf());
    for entry in fs::read_dir(path).map_err(|_| "Could not read app data for migration.")? {
        let path = entry.map_err(|_| "Could not inspect app data.")?.path();
        regular(&path)?;
        if path.is_dir() { inventory(root, &path, files, folders)?; }
        else if path.is_file() { files.insert(path.strip_prefix(root).unwrap().to_path_buf(), digest(&path)?); }
        else { return Err("An unsupported file was found. Your data was preserved.".into()); }
    }
    Ok(())
}

pub struct MigrationLock { file: Option<fs::File>, path: PathBuf }
impl Drop for MigrationLock {
    fn drop(&mut self) { self.file.take(); let _ = fs::remove_file(&self.path); }
}
pub fn lock(destination: &Path) -> Result<MigrationLock, String> {
    regular(destination)?;
    let parent = destination.parent().ok_or("AppData is unavailable.")?;
    fs::create_dir_all(parent).map_err(|_| "Could not prepare AppData.")?;
    let path = parent.join("Umalytics-migration.lock");
    regular(&path)?;
    let deadline = Instant::now() + Duration::from_secs(30);
    loop {
        let mut options = fs::OpenOptions::new();
        options.read(true).write(true).create(true);
        #[cfg(windows)] {
            use std::os::windows::fs::OpenOptionsExt;
            options.share_mode(0);
        }
        if let Ok(file) = options.open(&path) {
            #[cfg(unix)] {
                use std::os::fd::AsRawFd;
                unsafe extern "C" { fn flock(fd: i32, operation: i32) -> i32; }
                if unsafe { flock(file.as_raw_fd(), 2 | 4) } != 0 {
                    if Instant::now() >= deadline { return Err("Another app is moving your data. Try again shortly.".into()); }
                    thread::sleep(Duration::from_millis(100)); continue;
                }
            }
            return Ok(MigrationLock { file: Some(file), path });
        }
        if Instant::now() >= deadline { return Err("Another app is moving your data. Try again shortly.".into()); }
        thread::sleep(Duration::from_millis(100));
    }
}

/// Caller holds the migration lock and has stopped the old collector.
/// Every original remains until the complete copy has passed a second hash check.
pub fn migrate(source: &Path, destination: &Path) -> Result<(), String> {
    regular(source)?; regular(destination)?;
    if source == destination { return Err("Source and destination must differ.".into()); }
    if destination.starts_with(source) || source.starts_with(destination) { return Err("Data folders must not contain each other.".into()); }
    if !source.exists() {
        return fs::create_dir_all(destination).map_err(|_| "Could not create the AppData folder.".into());
    }
    let mut files = BTreeMap::new(); let mut folders = Vec::new();
    inventory(source, source, &mut files, &mut folders)?;
    // Check all conflicts before copying or deleting anything, including CA identity.
    for relative in &folders {
        let target = destination.join(relative); regular(&target)?;
        if target.exists() && !target.is_dir() { return Err("Conflicting app data was preserved in both locations.".into()); }
    }
    for (relative, hash) in &files {
        let target = destination.join(relative); regular(&target)?;
        if target.exists() && (!target.is_file() || digest(&target)? != *hash) {
            return Err("The two data folders contain different files. Both copies were preserved.".into());
        }
    }
    for relative in &folders { fs::create_dir_all(destination.join(relative)).map_err(|_| "Could not prepare the AppData copy.")?; }
    for (relative, hash) in &files {
        let target = destination.join(relative);
        if target.exists() { continue; }
        let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).map_err(|_| "System clock is unavailable.")?.as_nanos();
        let temporary = target.with_file_name(format!(".umalytics-migration-{}-{stamp}.partial", std::process::id()));
        let mut output = fs::OpenOptions::new().write(true).create_new(true).open(&temporary).map_err(|_| "Could not prepare the AppData copy.")?;
        let result = (|| {
            let mut input = fs::File::open(source.join(relative)).map_err(|_| "Could not open app data for copying.")?;
            std::io::copy(&mut input, &mut output).map_err(|_| "Could not copy app data. Original files are still available.")?;
            output.sync_all().map_err(|_| "Could not finish writing the AppData copy.")?;
            drop(output);
            if digest(&temporary)? != *hash { return Err("The data copy did not pass verification. Original files were preserved.".to_string()); }
            fs::rename(&temporary, &target).map_err(|_| "Could not finish the AppData copy.".to_string())
        })();
        if result.is_err() { let _ = fs::remove_file(&temporary); }
        result?;
    }
    let mut checked = BTreeMap::new(); let mut checked_folders = Vec::new();
    inventory(source, source, &mut checked, &mut checked_folders)?;
    if checked != files || checked_folders.len() != folders.len() { return Err("App data changed during migration. Close the older app and retry.".into()); }
    for (relative, hash) in &files {
        if digest(&destination.join(relative))? != *hash { return Err("AppData verification failed. Original files were preserved.".into()); }
    }
    for (relative, hash) in &files {
        let original = source.join(relative);
        if digest(&original)? != *hash { return Err("An original file changed. Remaining files were preserved.".into()); }
        let deadline = Instant::now() + Duration::from_secs(20);
        while let Err(error) = fs::remove_file(&original) {
            if error.kind() == std::io::ErrorKind::NotFound { break; }
            if Instant::now() >= deadline { return Err("The copy is verified, but the older app still holds a file. Close it and reopen Umalytics to finish.".into()); }
            thread::sleep(Duration::from_millis(200));
        }
    }
    folders.sort_by_key(|path| std::cmp::Reverse(path.components().count()));
    for relative in folders { fs::remove_dir(source.join(relative)).map_err(|_| "An old folder still contains files. The verified AppData copy is safe.")?; }
    Ok(())
}

pub fn approved_data(data: &Path, install: &Path) -> bool {
    let same = |other: &Path| match (fs::canonicalize(data), fs::canonicalize(other)) {
        (Ok(a), Ok(b)) => {
            #[cfg(windows)] { a.to_string_lossy().eq_ignore_ascii_case(&b.to_string_lossy()) }
            #[cfg(not(windows))] { a == b }
        },
        _ => false,
    };
    same(&install.join("Umalytics-data")) || user_data().is_ok_and(|path| same(&path))
}
