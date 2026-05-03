//! Serves the bundled frontend SPA out of the binary.
//!
//! Only compiled when the `embed-frontend` feature is enabled. In dev (default
//! cargo build), the frontend runs separately under Vite and proxies `/api`
//! to this server.

use axum::{
    Router,
    body::Body,
    http::{HeaderValue, StatusCode, Uri, header},
    response::{IntoResponse, Response},
    routing::get,
};
use rust_embed::Embed;

#[derive(Embed)]
#[folder = "../../frontend/dist/"]
struct Asset;

pub fn router() -> Router {
    Router::new().fallback(get(serve))
}

async fn serve(uri: Uri) -> Response {
    let path = uri.path().trim_start_matches('/');
    if let Some(resp) = lookup(path) {
        return resp;
    }
    // SPA fallback for client-side routes.
    lookup("index.html").unwrap_or_else(|| {
        (StatusCode::NOT_FOUND, "frontend assets missing").into_response()
    })
}

fn lookup(path: &str) -> Option<Response> {
    let asset = Asset::get(path)?;
    let mime = mime_guess::from_path(path).first_or_octet_stream();
    let mut response = Response::new(Body::from(asset.data.into_owned()));
    response.headers_mut().insert(
        header::CONTENT_TYPE,
        HeaderValue::from_str(mime.as_ref()).unwrap_or(HeaderValue::from_static("application/octet-stream")),
    );
    Some(response)
}
