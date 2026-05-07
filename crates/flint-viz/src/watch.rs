//! `notify`-driven file watcher that publishes `FileEvent`s on a broadcast
//! channel. The SSE handler in `api::events` is the consumer.
//!
//! Pipeline:
//!   notify thread (sync callback)
//!     -> tokio::sync::mpsc (raw events)
//!     -> debounce+filter task
//!     -> tokio::sync::broadcast (one Sender, many SSE subscribers)
//!
//! Debounce rule: emit at most one event per `id` per `DEBOUNCE_WINDOW`. This
//! collapses the bursts that editors generate (atomic-rename writes, vim's
//! 4500.tmp shuffle, etc.) into a single change notification.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::{Duration, Instant};

use notify::{
    Config, Event, EventKind, RecommendedWatcher, RecursiveMode, Watcher,
    event::{CreateKind, ModifyKind},
};
use serde::Serialize;
use tokio::sync::broadcast;

use crate::state::AppState;
use crate::util::relative_id;

const DEBOUNCE_WINDOW: Duration = Duration::from_millis(100);

/// Event broadcast to SSE subscribers. The `id` matches the same forward-slash
/// path-relative-to-test-root id used by `/api/tests/:id`.
#[derive(Debug, Clone, Serialize)]
pub struct FileEvent {
    pub id: String,
}

/// Spawn the watcher. The returned guard owns the underlying `notify::Watcher`
/// and must be kept alive for the lifetime of the server — dropping it stops
/// the watch.
pub fn spawn(state: Arc<AppState>) -> notify::Result<WatcherGuard> {
    let (raw_tx, raw_rx) = tokio::sync::mpsc::unbounded_channel::<notify::Result<Event>>();

    let mut watcher = RecommendedWatcher::new(
        move |res| {
            // The notify callback runs on its own thread. `send` on an
            // unbounded channel is non-blocking; ignore failure (receiver
            // dropped means the server is shutting down).
            let _ = raw_tx.send(res);
        },
        Config::default(),
    )?;
    watcher.watch(&state.test_root, RecursiveMode::Recursive)?;

    let root = state.test_root.clone();
    let tx = state.file_events.clone();
    tokio::spawn(process_events(raw_rx, root, tx));

    Ok(WatcherGuard { _inner: watcher })
}

/// Keeps the underlying `notify::Watcher` alive. Drop to stop watching.
pub struct WatcherGuard {
    _inner: RecommendedWatcher,
}

async fn process_events(
    mut raw_rx: tokio::sync::mpsc::UnboundedReceiver<notify::Result<Event>>,
    root: PathBuf,
    tx: broadcast::Sender<FileEvent>,
) {
    let mut last_emit: HashMap<String, Instant> = HashMap::new();
    while let Some(res) = raw_rx.recv().await {
        let event = match res {
            Ok(e) => e,
            Err(err) => {
                tracing::warn!("file watcher error: {err}");
                continue;
            }
        };
        if !is_relevant_kind(&event.kind) {
            continue;
        }
        for path in &event.paths {
            if !is_json(path) {
                continue;
            }
            let id = relative_id(&root, path);
            if id.is_empty() {
                continue;
            }
            let now = Instant::now();
            if let Some(prev) = last_emit.get(&id) {
                if now.duration_since(*prev) < DEBOUNCE_WINDOW {
                    continue;
                }
            }
            last_emit.insert(id.clone(), now);
            // `send` only fails when there are zero active receivers; that's
            // expected when no SSE clients are connected.
            let _ = tx.send(FileEvent { id });
        }
    }
}

fn is_json(path: &Path) -> bool {
    path.extension().and_then(|s| s.to_str()) == Some("json")
}

/// We want to react to writes and atomic-rename writes (which surface as
/// Create on the new path), but ignore pure access events. Removes are
/// included so the frontend can react to deletions if it wants to.
fn is_relevant_kind(kind: &EventKind) -> bool {
    matches!(
        kind,
        EventKind::Create(CreateKind::File | CreateKind::Any)
            | EventKind::Modify(ModifyKind::Data(_) | ModifyKind::Name(_) | ModifyKind::Any)
            | EventKind::Remove(_)
    )
}

#[cfg(test)]
mod tests {
    use super::*;
    use notify::event::{DataChange, RemoveKind, RenameMode};

    #[test]
    fn json_filter_matches_extension() {
        assert!(is_json(Path::new("a.json")));
        assert!(is_json(Path::new("nested/b.json")));
        assert!(!is_json(Path::new("a.txt")));
        assert!(!is_json(Path::new("noext")));
    }

    #[test]
    fn relevant_kinds() {
        assert!(is_relevant_kind(&EventKind::Create(CreateKind::File)));
        assert!(is_relevant_kind(&EventKind::Modify(ModifyKind::Data(
            DataChange::Any
        ))));
        assert!(is_relevant_kind(&EventKind::Modify(ModifyKind::Name(
            RenameMode::To
        ))));
        assert!(is_relevant_kind(&EventKind::Remove(RemoveKind::File)));
        assert!(!is_relevant_kind(&EventKind::Access(
            notify::event::AccessKind::Read
        )));
    }
}
