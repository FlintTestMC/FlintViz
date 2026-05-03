//! `GET /api/tests` — recursive walk of the test root, returns one entry
//! per `*.json` file with parsed header metadata. Files that fail to parse
//! are returned with the file stem as `name`, empty tags, and a `parse_error`.

use std::path::{Path, PathBuf};
use std::sync::Arc;

use axum::{
    Json, Router,
    extract::{Path as AxumPath, State},
    http::StatusCode,
    routing::get,
};
use flint_core::test_spec::TestSpec;
use serde::Serialize;
use walkdir::WalkDir;

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new()
        .route("/api/tests", get(list_tests))
        .route("/api/tests/{*id}", get(get_test))
}

#[derive(Debug, Serialize)]
pub struct TestSummary {
    /// Path relative to the test root, with forward slashes. Used as the id
    /// in subsequent endpoints (e.g. `GET /api/tests/:id`).
    pub id: String,
    /// Absolute path to the file on disk.
    pub path: String,
    /// `name` field from the test JSON, or the file stem if the file failed to parse.
    pub name: String,
    pub tags: Vec<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub parse_error: Option<String>,
}

async fn list_tests(State(state): State<Arc<AppState>>) -> Json<Vec<TestSummary>> {
    let root = state.test_root.clone();
    let summaries = tokio::task::spawn_blocking(move || walk(&root))
        .await
        .unwrap_or_default();
    Json(summaries)
}

fn walk(root: &Path) -> Vec<TestSummary> {
    let mut summaries = Vec::new();
    for entry in WalkDir::new(root).into_iter().filter_map(Result::ok) {
        if !entry.file_type().is_file() {
            continue;
        }
        let path = entry.path();
        if path.extension().and_then(|s| s.to_str()) != Some("json") {
            continue;
        }
        let id = relative_id(root, path);
        summaries.push(read_one(path, id));
    }
    summaries.sort_by(|a, b| a.id.cmp(&b.id));
    summaries
}

fn relative_id(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.components()
        .map(|c| c.as_os_str().to_string_lossy().into_owned())
        .collect::<Vec<_>>()
        .join("/")
}

fn read_one(path: &Path, id: String) -> TestSummary {
    let stem = path
        .file_stem()
        .map(|s| s.to_string_lossy().into_owned())
        .unwrap_or_else(|| id.clone());
    let path_str = path.to_string_lossy().into_owned();

    let bytes = match std::fs::read(path) {
        Ok(b) => b,
        Err(err) => {
            return TestSummary {
                id,
                path: path_str,
                name: stem,
                tags: Vec::new(),
                parse_error: Some(format!("read failed: {err}")),
            };
        }
    };

    match serde_json::from_slice::<TestSpec>(&bytes) {
        Ok(spec) => TestSummary {
            id,
            path: path_str,
            name: spec.name,
            tags: spec.tags,
            parse_error: None,
        },
        Err(err) => TestSummary {
            id,
            path: path_str,
            name: stem,
            tags: Vec::new(),
            parse_error: Some(err.to_string()),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn walks_recursively_and_parses_valid() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(
            root.join("a.json"),
            r#"{"name":"alpha","tags":["x","y"],"timeline":[]}"#,
        )
        .unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(
            root.join("sub/b.json"),
            r#"{"name":"beta","tags":[],"timeline":[]}"#,
        )
        .unwrap();
        fs::write(root.join("ignore.txt"), "nope").unwrap();

        let mut got = walk(root);
        got.sort_by(|a, b| a.id.cmp(&b.id));

        assert_eq!(got.len(), 2);
        assert_eq!(got[0].id, "a.json");
        assert_eq!(got[0].name, "alpha");
        assert_eq!(got[0].tags, vec!["x".to_string(), "y".to_string()]);
        assert!(got[0].parse_error.is_none());
        assert_eq!(got[1].id, "sub/b.json");
        assert_eq!(got[1].name, "beta");
    }

    #[test]
    fn parse_failure_falls_back_to_stem() {
        let dir = TempDir::new().unwrap();
        let root = dir.path();
        fs::write(root.join("broken.json"), "{ not json").unwrap();

        let got = walk(root);
        assert_eq!(got.len(), 1);
        assert_eq!(got[0].id, "broken.json");
        assert_eq!(got[0].name, "broken");
        assert!(got[0].tags.is_empty());
        assert!(got[0].parse_error.is_some());
    }
}
