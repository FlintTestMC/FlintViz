//! Shared Flint-to-FlintViz replay adapter.
//!
//! This crate intentionally contains no filesystem, server, or browser logic,
//! allowing the same parser and replay implementation to run natively and in
//! WebAssembly.

pub mod aabb;
pub mod assertions;
pub mod engine;
pub mod model;
pub mod player;
pub mod source_map;

use flint_core::test_spec::TestSpec;
use serde::Serialize;

pub use engine::{MAX_FILL_BLOCKS, compute};
pub use model::{
    Aabb, AssertionView, PlayerSnapshot, Replay, ReplayError, SourceSpan, TickEvent, TickFrame,
};

#[derive(Debug, Serialize)]
pub struct ReplayResponse {
    pub spec: Option<TestSpec>,
    pub errors: Vec<ParseError>,
    pub replay: Option<Replay>,
}

#[derive(Debug, Serialize)]
pub struct ParseError {
    pub line: usize,
    pub col: usize,
    pub message: String,
}

pub fn replay_json(source: &str) -> ReplayResponse {
    match serde_json::from_str::<TestSpec>(source) {
        Ok(spec) => {
            let replay = compute(&spec);
            ReplayResponse {
                spec: Some(spec),
                errors: Vec::new(),
                replay: Some(replay),
            }
        }
        Err(err) => ReplayResponse {
            spec: None,
            errors: vec![ParseError {
                line: err.line(),
                col: err.column(),
                message: err.to_string(),
            }],
            replay: None,
        },
    }
}

#[cfg(feature = "wasm")]
mod wasm {
    use wasm_bindgen::prelude::*;

    #[wasm_bindgen(start)]
    pub fn start() {
        console_error_panic_hook::set_once();
    }

    #[wasm_bindgen(js_name = replay)]
    pub fn replay(source: &str) -> Result<String, JsValue> {
        serde_json::to_string(&super::replay_json(source))
            .map_err(|err| JsValue::from_str(&err.to_string()))
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_json_reports_serde_locations() {
        let response = replay_json("{\n");
        assert!(response.spec.is_none());
        assert!(response.replay.is_none());
        assert_eq!(response.errors.len(), 1);
        assert!(response.errors[0].line >= 1);
    }
}
