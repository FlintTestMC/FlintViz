mod cli;
#[cfg(feature = "embed-frontend")]
mod embed;
mod state;

use std::path::{Path, PathBuf};
use std::process::ExitCode;
use std::sync::Arc;

use axum::{Router, extract::State, routing::get};
use clap::Parser;
use tracing_subscriber::EnvFilter;

use crate::cli::{Cli, Command};
use crate::state::AppState;

#[tokio::main]
async fn main() -> ExitCode {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let cli = Cli::parse();
    match cli.command {
        Command::Serve { path, port, open } => match run_serve(path, port, open).await {
            Ok(()) => ExitCode::SUCCESS,
            Err(err) => {
                eprintln!("error: {err}");
                ExitCode::FAILURE
            }
        },
    }
}

async fn run_serve(
    path: Option<PathBuf>,
    port: u16,
    open: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let test_root = resolve_test_root(path.as_deref())?;
    tracing::info!("test root: {}", test_root.display());

    let state = AppState::new(test_root);

    let api = Router::new()
        .route("/healthz", get(healthz))
        .with_state(state);

    #[cfg(feature = "embed-frontend")]
    let app = api.merge(embed::router());
    #[cfg(not(feature = "embed-frontend"))]
    let app = api;

    let addr = format!("127.0.0.1:{port}");
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let url = format!("http://{addr}");
    tracing::info!("flint-viz listening on {url}");

    if open {
        if let Err(err) = webbrowser::open(&url) {
            tracing::warn!("failed to open browser: {err}");
        }
    }

    axum::serve(listener, app).await?;
    Ok(())
}

fn resolve_test_root(path: Option<&Path>) -> Result<PathBuf, String> {
    let raw = path.unwrap_or_else(|| Path::new("."));
    if !raw.exists() {
        return Err(format!(
            "test path `{}` does not exist",
            raw.display()
        ));
    }
    if !raw.is_dir() {
        return Err(format!(
            "test path `{}` is not a directory",
            raw.display()
        ));
    }
    raw.canonicalize().map_err(|err| {
        format!("failed to canonicalize test path `{}`: {err}", raw.display())
    })
}

async fn healthz(State(_state): State<Arc<AppState>>) -> &'static str {
    "ok"
}
