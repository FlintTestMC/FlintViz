use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::broadcast;

use crate::watch::FileEvent;

/// Shared application state passed to axum handlers via `State<Arc<AppState>>`.
#[derive(Debug)]
pub struct AppState {
    /// Absolute, canonicalized path to the directory holding Flint test JSON files.
    pub test_root: PathBuf,
    /// Broadcast sender for file-change events. Each SSE connection subscribes
    /// for the lifetime of the connection; the watcher task publishes here.
    pub file_events: broadcast::Sender<FileEvent>,
}

/// Capacity of the file-event broadcast channel. Slow subscribers that fall
/// behind by more than this many events will see `RecvError::Lagged` — the
/// SSE handler treats that as a non-fatal skip.
const FILE_EVENT_CHANNEL_CAP: usize = 64;

impl AppState {
    pub fn new(test_root: PathBuf) -> Arc<Self> {
        let (file_events, _) = broadcast::channel(FILE_EVENT_CHANNEL_CAP);
        Arc::new(Self {
            test_root,
            file_events,
        })
    }
}
