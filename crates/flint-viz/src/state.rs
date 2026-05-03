use std::path::PathBuf;
use std::sync::Arc;

/// Shared application state passed to axum handlers via `State<Arc<AppState>>`.
#[derive(Debug)]
pub struct AppState {
    /// Absolute, canonicalized path to the directory holding Flint test JSON files.
    #[allow(dead_code)] // consumed by API endpoints starting in #0006
    pub test_root: PathBuf,
}

impl AppState {
    pub fn new(test_root: PathBuf) -> Arc<Self> {
        Arc::new(Self { test_root })
    }
}
