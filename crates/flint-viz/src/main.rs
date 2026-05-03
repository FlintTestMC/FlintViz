use axum::{Router, routing::get};
use tracing_subscriber::EnvFilter;

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::try_from_default_env().unwrap_or_else(|_| "info".into()))
        .init();

    let app = Router::new().route("/healthz", get(healthz));

    let addr = "127.0.0.1:7878";
    let listener = tokio::net::TcpListener::bind(addr).await?;
    tracing::info!("flint-viz listening on http://{addr}");
    axum::serve(listener, app).await?;
    Ok(())
}

async fn healthz() -> &'static str {
    "ok"
}
