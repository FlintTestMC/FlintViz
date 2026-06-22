//! `GET /api/config` — runtime capabilities the frontend reads on startup.
//! Today this is only `{ readonly: bool }`; structured as its own endpoint so
//! later additions (mode, version, virtual-directory info) don't bloat
//! `/api/tests` or other handlers.

use std::sync::Arc;

use axum::{Json, Router, extract::State, routing::get};
use serde::Serialize;

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/api/config", get(get_config))
}

#[derive(Debug, Serialize)]
pub struct Config {
    pub readonly: bool,
}

async fn get_config(State(state): State<Arc<AppState>>) -> Json<Config> {
    Json(Config {
        readonly: state.readonly,
    })
}
