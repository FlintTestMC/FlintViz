mod api;
mod cli;
#[cfg(feature = "embed-frontend")]
mod embed;
mod state;
mod util;
mod watch;

use std::net::{IpAddr, Ipv4Addr, SocketAddr};
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
        Command::Serve {
            path,
            host,
            port,
            open,
        } => match run_serve(path, host, port, open).await {
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
    host: IpAddr,
    port: u16,
    open: bool,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let test_root = resolve_test_root(path.as_deref())?;
    let readonly = test_root.is_none();
    match &test_root {
        Some(root) => tracing::info!("test root: {}", root.display()),
        None => tracing::info!(
            "no path given — running in read-only mode (failure-URL viewer only)"
        ),
    }

    let state = AppState::new(test_root.clone(), readonly);

    let _watcher = if let Some(root) = test_root {
        Some(
            watch::spawn(state.clone(), root)
                .map_err(|err| format!("failed to start file watcher: {err}"))?,
        )
    } else {
        None
    };

    let api = Router::new()
        .route("/healthz", get(healthz))
        .merge(api::router())
        .with_state(state);

    #[cfg(feature = "embed-frontend")]
    let app = api.merge(embed::router());
    #[cfg(not(feature = "embed-frontend"))]
    let app = api;

    let addr = SocketAddr::new(host, port);
    let listener = tokio::net::TcpListener::bind(&addr).await?;
    let display_host = if host.is_unspecified() {
        IpAddr::V4(Ipv4Addr::LOCALHOST)
    } else {
        host
    };
    let url = format!("http://{}", SocketAddr::new(display_host, port));
    tracing::info!("flint-viz listening on {url} (bound to {addr})");

    if open && let Err(err) = webbrowser::open(&url) {
        tracing::warn!("failed to open browser: {err}");
    }

    axum::serve(listener, app).await?;
    Ok(())
}

fn resolve_test_root(path: Option<&Path>) -> Result<Option<PathBuf>, String> {
    let Some(raw) = path else {
        return Ok(None);
    };
    if !raw.exists() {
        return Err(format!(
            "test path `{}` does not exist.\n\
             hint: pass a directory containing your Flint test JSON files, e.g.\n\
             \tflint-viz serve ~/flint/FlintCLI/FlintBenchmark/tests",
            raw.display()
        ));
    }
    if !raw.is_dir() {
        return Err(format!(
            "test path `{}` is not a directory.\n\
             hint: flint-viz serves a *directory* of tests, not a single test file.",
            raw.display()
        ));
    }
    raw.canonicalize()
        .map(Some)
        .map_err(|err| {
            format!(
                "failed to canonicalize test path `{}`: {err}.\n\
                 hint: check directory permissions or that the path is reachable.",
                raw.display()
            )
        })
}

async fn healthz(State(_state): State<Arc<AppState>>) -> &'static str {
    "ok"
}
