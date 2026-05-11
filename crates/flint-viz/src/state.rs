use std::path::PathBuf;
use std::sync::Arc;

use tokio::sync::broadcast;

use crate::watch::FileEvent;

/// Shared application state passed to axum handlers via `State<Arc<AppState>>`.
#[derive(Debug)]
pub struct AppState {
    /// Absolute, canonicalized path to the directory holding Flint test JSON
    /// files. `None` when the server was launched without a path argument —
    /// in that mode only the failure-URL viewer is reachable.
    pub test_root: Option<PathBuf>,
    /// True when writes are disallowed. Kept independent of `test_root` so a
    /// future virtual-directory mode can be readonly without a disk root, or
    /// writable with one.
    pub readonly: bool,
    /// Broadcast sender for file-change events. Each SSE connection subscribes
    /// for the lifetime of the connection; the watcher task publishes here.
    pub file_events: broadcast::Sender<FileEvent>,
}

/// Capacity of the file-event broadcast channel. Slow subscribers that fall
/// behind by more than this many events will see `RecvError::Lagged` — the
/// SSE handler treats that as a non-fatal skip.
const FILE_EVENT_CHANNEL_CAP: usize = 64;

impl AppState {
    pub fn new(test_root: Option<PathBuf>, readonly: bool) -> Arc<Self> {
        let (file_events, _) = broadcast::channel(FILE_EVENT_CHANNEL_CAP);
        Arc::new(Self {
            test_root,
            readonly,
            file_events,
        })
    }
}
