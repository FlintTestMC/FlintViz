//! `POST /api/failure/decode` — decode a flint-steel failure URL payload.
//!
//! flint-steel emits clickable URLs of the form
//! `http://<host>/failure#data=<base64url(gzip(json))>`. The fragment is
//! client-side only, so the SPA reads it on mount and posts the encoded blob
//! here. This handler reuses `flint_core::viz_link::decode` so we don't
//! reimplement the `TestSpec` deserializer in TypeScript.

use std::sync::Arc;

use axum::{
    Json, Router,
    extract::DefaultBodyLimit,
    http::StatusCode,
    response::{IntoResponse, Response},
    routing::post,
};
use flint_core::viz_link::{FailurePayload, decode};
use serde::{Deserialize, Serialize};

use crate::state::AppState;

/// Encoded failure URLs are typically a few KB, but a TestSpec can grow if a
/// timeline is large. Cap the request body conservatively.
const BODY_LIMIT_BYTES: usize = 256 * 1024;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/failure/decode", post(decode_handler))
        .layer(DefaultBodyLimit::max(BODY_LIMIT_BYTES))
}

#[derive(Debug, Deserialize)]
pub struct DecodeRequest {
    pub encoded: String,
}

#[derive(Debug, Serialize)]
pub struct DecodeError {
    pub message: String,
}

async fn decode_handler(Json(req): Json<DecodeRequest>) -> Response {
    match decode(&req.encoded) {
        Ok(payload) => Json::<FailurePayload>(payload).into_response(),
        Err(err) => (
            StatusCode::BAD_REQUEST,
            Json(DecodeError {
                message: err.to_string(),
            }),
        )
            .into_response(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use flint_core::results::{AssertFailure, AssertPosition, InfoType};
    use flint_core::test_spec::{Block, TestSpec};
    use flint_core::viz_link::{FailurePayload, encode};

    fn sample_payload() -> FailurePayload {
        FailurePayload::new(
            TestSpec {
                flint_version: None,
                name: "decode-fixture".to_string(),
                description: None,
                tags: Vec::new(),
                minecraft_ids: Vec::new(),
                dependencies: Vec::new(),
                setup: None,
                timeline: Vec::new(),
                breakpoints: Vec::new(),
            },
            None,
            vec![AssertFailure {
                tick: 3,
                error_message: "boom".to_string(),
                position: AssertPosition::from_array([0, 1, 0]),
                execution_time_ms: None,
                expected: InfoType::Block(Block::new("minecraft:stone")),
                actual: InfoType::Block(Block::new("minecraft:air")),
            }],
            5,
        )
    }

    #[test]
    fn round_trips_through_handler_logic() {
        // The handler is async; this test exercises the same decode path
        // synchronously to keep the test rig minimal.
        let encoded = encode(&sample_payload()).unwrap();
        let decoded = decode(&encoded).unwrap();
        assert_eq!(decoded.spec.name, "decode-fixture");
        assert_eq!(decoded.failures.len(), 1);
        assert_eq!(decoded.total_ticks, 5);
    }

    #[test]
    fn decode_returns_error_for_bad_input() {
        assert!(decode("not base64!!!").is_err());
    }
}
