//! Small helpers shared between the watcher and the api layer.

use std::path::Path;

/// Compute the forward-slash id of `path` relative to `root`.
/// Falls back to the full path components if `path` is not under `root`.
pub fn relative_id(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}
