//! A live game must keep its capture proxy running.
pub fn exit_blocked(status: Option<&serde_json::Value>) -> bool {
    status.is_none_or(|status| status["update"]["gameActive"].as_bool() != Some(false))
}

pub fn exit_label(blocked: bool) -> &'static str {
    if blocked { "Exit Umalytics and stop collection (Close game first)" }
    else { "Exit Umalytics and stop collection" }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn live_game_blocks_exit_even_between_network_requests() {
        let active = json!({"update":{"gameActive":true},"proxy":{"activeGameConnections":0}});
        assert!(exit_blocked(Some(&active)));
        assert!(exit_label(true).ends_with("(Close game first)"));
    }

    #[test]
    fn game_close_enables_exit_and_unknown_state_cannot_stop_capture() {
        assert!(!exit_blocked(Some(&json!({"update":{"gameActive":false}}))));
        assert!(exit_blocked(None));
        assert!(exit_blocked(Some(&json!({}))));
        assert!(!exit_label(false).contains("Close game first"));
    }
}
