use std::sync::Arc;

use axum::Router;

use crate::state::AppState;

pub mod replay;
pub mod tests;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .merge(tests::router())
        .merge(replay::router())
}
