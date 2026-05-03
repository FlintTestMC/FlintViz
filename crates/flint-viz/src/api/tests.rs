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
use crate::util::relative_id;

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

#[derive(Debug, Serialize)]
pub struct TestDetail {
    pub id: String,
    pub source: String,
    pub spec: Option<TestSpec>,
    pub parse_error: Option<String>,
}

async fn get_test(
    State(state): State<Arc<AppState>>,
    AxumPath(id): AxumPath<String>,
) -> Result<Json<TestDetail>, (StatusCode, &'static str)> {
    let root = state.test_root.clone();
    tokio::task::spawn_blocking(move || load_test(&root, &id))
        .await
        .map_err(|_| (StatusCode::INTERNAL_SERVER_ERROR, "task join failed"))?
        .map(Json)
}

fn load_test(root: &Path, id: &str) -> Result<TestDetail, (StatusCode, &'static str)> {
    let resolved = resolve_under_root(root, id)?;
    if !resolved.is_file() {
        return Err((StatusCode::NOT_FOUND, "test not found"));
    }
    let source = std::fs::read_to_string(&resolved)
        .map_err(|_| (StatusCode::NOT_FOUND, "test not found"))?;

    let normalized_id = relative_id(root, &resolved);
    let (spec, parse_error) = match serde_json::from_str::<TestSpec>(&source) {
        Ok(spec) => (Some(spec), None),
        Err(err) => (None, Some(err.to_string())),
    };

    Ok(TestDetail {
        id: normalized_id,
        source,
        spec,
        parse_error,
    })
}

/// Resolve `id` against `root`, canonicalize, and verify the result lives under `root`.
/// `root` is expected to already be canonicalized (see `resolve_test_root` in `main.rs`).
fn resolve_under_root(root: &Path, id: &str) -> Result<PathBuf, (StatusCode, &'static str)> {
    if id.is_empty() {
        return Err((StatusCode::BAD_REQUEST, "id must not be empty"));
    }
    let candidate = root.join(id);
    let canonical = candidate
        .canonicalize()
        .map_err(|_| (StatusCode::NOT_FOUND, "test not found"))?;
    if !canonical.starts_with(root) {
        return Err((StatusCode::BAD_REQUEST, "id escapes test root"));
    }
    Ok(canonical)
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

    #[test]
    fn load_test_returns_source_and_spec() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let body = r#"{"name":"alpha","tags":["x"],"timeline":[]}"#;
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(root.join("sub/a.json"), body).unwrap();

        let detail = load_test(&root, "sub/a.json").unwrap();
        assert_eq!(detail.id, "sub/a.json");
        assert_eq!(detail.source, body);
        assert!(detail.parse_error.is_none());
        let spec = detail.spec.unwrap();
        assert_eq!(spec.name, "alpha");
        assert_eq!(spec.tags, vec!["x".to_string()]);
    }

    #[test]
    fn load_test_returns_source_with_parse_error() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let body = "{ not json";
        fs::write(root.join("broken.json"), body).unwrap();

        let detail = load_test(&root, "broken.json").unwrap();
        assert_eq!(detail.source, body);
        assert!(detail.spec.is_none());
        assert!(detail.parse_error.is_some());
    }

    #[test]
    fn load_test_missing_returns_404() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        let err = load_test(&root, "nope.json").unwrap_err();
        assert_eq!(err.0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn load_test_directory_returns_404() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        let err = load_test(&root, "sub").unwrap_err();
        assert_eq!(err.0, StatusCode::NOT_FOUND);
    }

    #[test]
    fn load_test_rejects_traversal() {
        let outer = TempDir::new().unwrap();
        let outer_path = outer.path().canonicalize().unwrap();
        fs::write(outer_path.join("secret.json"), r#"{"x":1}"#).unwrap();

        fs::create_dir(outer_path.join("root")).unwrap();
        let root = outer_path.join("root");
        fs::write(root.join("ok.json"), r#"{"name":"x","timeline":[]}"#).unwrap();

        let err = load_test(&root, "../secret.json").unwrap_err();
        assert_eq!(err.0, StatusCode::BAD_REQUEST);
    }

    #[test]
    fn load_test_normalizes_id() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().canonicalize().unwrap();
        fs::create_dir(root.join("sub")).unwrap();
        fs::write(
            root.join("sub/a.json"),
            r#"{"name":"alpha","timeline":[]}"#,
        )
        .unwrap();

        let detail = load_test(&root, "sub/./a.json").unwrap();
        assert_eq!(detail.id, "sub/a.json");
    }
}
