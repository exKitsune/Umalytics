//! Destinations explicitly exposed by the app's links.
pub fn allowed(scheme: &str, host: Option<&str>, port: Option<u16>, path: &str, service_port: u16) -> bool {
    if scheme == "http" && host == Some("127.0.0.1") && port == Some(service_port) {
        return matches!(path, "/api/licenses" | "/LICENSE.txt" | "/data/NOTICE.txt");
    }
    if scheme != "https" || port.is_some_and(|p| p != 443) { return false; }
    match host {
        Some("github.com") => ["/exKitsune/Umalytics", "/exKitsune/GlobalSim"].iter()
            .any(|repo| path == *repo || path.starts_with(&format!("{repo}/"))),
        Some("umalator.app") => path == "/umalator-global/",
        Some("gametora.com") => path.starts_with("/\u{0075}mamusume/supports/")
            || path.starts_with("/\u{0075}mamusume/characters/") || path == "/\u{0075}mamusume/skill-condition-viewer",
        _ => false,
    }
}

#[cfg(test)]
mod tests {
    use super::allowed;
    #[test]
    fn legal_links_open_only_on_the_owned_service_and_named_repositories() {
        for port in [4317, 52835] {
            for path in ["/LICENSE.txt", "/api/licenses", "/data/NOTICE.txt"] {
                assert!(allowed("http", Some("127.0.0.1"), Some(port), path, port));
                assert!(!allowed("http", Some("127.0.0.1"), Some(port + 1), path, port));
            }
        }
        assert!(allowed("https", Some("github.com"), None, "/exKitsune/Umalytics/releases/tag/v0.2.1", 4317));
        assert!(!allowed("https", Some("github.com"), None, "/exKitsune/Umalytics-other", 4317));
        assert!(!allowed("https", Some("github.com.evil.invalid"), None, "/exKitsune/Umalytics", 4317));
        assert!(!allowed("https", Some("github.com"), Some(8443), "/exKitsune/Umalytics", 4317));
        assert!(!allowed("http", Some("127.0.0.1"), Some(4317), "/api/app/exit", 4317));
        assert!(!allowed("file", None, None, "/LICENSE.txt", 4317));
    }
}
