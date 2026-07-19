//! `POST /api/replay` — parse a raw JSON test body and run the static replay
//! engine over it.
//!
//! Accepts a raw JSON test body (an unsaved editor buffer), parses it as a
//! `TestSpec`, and returns either the parsed spec + computed `Replay`, or a
//! structured parse error with line/column for Monaco squiggles.

use std::sync::Arc;

use crate::state::AppState;
use axum::{Json, Router, extract::DefaultBodyLimit, routing::post};
use flint_viz_replay::ReplayResponse;

const BODY_LIMIT_BYTES: usize = 1024 * 1024;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/replay", post(replay))
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
}

async fn replay(body: String) -> Json<ReplayResponse> {
    Json(parse(&body))
}

fn parse(body: &str) -> ReplayResponse {
    flint_viz_replay::replay_json(body)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_valid_spec_and_computes_replay() {
        let body = r#"{"name":"alpha","tags":["x"],"timeline":[]}"#;
        let resp = parse(body);
        assert!(resp.errors.is_empty());
        let spec = resp.spec.unwrap();
        assert_eq!(spec.name, "alpha");
        assert_eq!(spec.tags, vec!["x".to_string()]);
        let replay = resp.replay.expect("replay computed for parsed spec");
        assert_eq!(replay.name, "alpha");
        assert_eq!(replay.max_tick, 0);
        assert!(replay.frames.is_empty());
    }

    #[test]
    fn computed_replay_walks_place_actions() {
        let body = r#"{
            "name": "wired",
            "setup": { "cleanup": { "region": [[0, 0, 0], [4, 4, 4]] } },
            "timeline": [
                { "at": 0, "do": "place", "pos": [1, 1, 1], "block": {"id": "minecraft:stone"} }
            ]
        }"#;
        let resp = parse(body);
        let replay = resp.replay.expect("replay present");
        assert_eq!(replay.frames.len(), 1);
        assert_eq!(replay.frames[0].events.len(), 1);
    }

    #[test]
    fn returns_structured_parse_error() {
        // line 2 col 1 — missing closing brace
        let body = "{\n";
        let resp = parse(body);
        assert!(resp.spec.is_none());
        assert_eq!(resp.errors.len(), 1);
        let err = &resp.errors[0];
        assert!(err.line >= 1);
        assert!(!err.message.is_empty());
    }

    #[test]
    fn rejects_missing_required_field() {
        // Valid JSON, but missing `name` and `timeline` — TestSpec deserialize fails.
        let body = r#"{"tags":[]}"#;
        let resp = parse(body);
        assert!(resp.spec.is_none());
        assert_eq!(resp.errors.len(), 1);
    }
}
