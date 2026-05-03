//! `GET /api/events` — Server-Sent Events stream.
//!
//! Each subscriber gets its own `broadcast::Receiver` for the lifetime of the
//! HTTP connection. Disconnects are handled by axum dropping the response
//! future, which drops the receiver and ends the stream.
//!
//! The response intentionally bypasses any compression layer: most reverse
//! proxies and `EventSource` clients misbehave when SSE is gzipped. We only
//! mount this route under `/api/events` and the project doesn't apply
//! compression upstream; if that changes, this handler needs an explicit
//! `no-compress` marker.

use std::convert::Infallible;
use std::sync::Arc;
use std::time::Duration;

use axum::{
    Router,
    extract::State,
    response::{
        Sse,
        sse::{Event, KeepAlive},
    },
    routing::get,
};
use tokio_stream::{Stream, StreamExt, wrappers::BroadcastStream};

use crate::state::AppState;

pub fn router() -> Router<Arc<AppState>> {
    Router::new().route("/api/events", get(events))
}

async fn events(
    State(state): State<Arc<AppState>>,
) -> Sse<impl Stream<Item = Result<Event, Infallible>>> {
    let rx = state.file_events.subscribe();
    let stream = BroadcastStream::new(rx).filter_map(|res| match res {
        Ok(file_event) => {
            // `json_data` only fails if serialization fails; FileEvent is a
            // simple struct and won't.
            Event::default()
                .event("file-changed")
                .json_data(file_event)
                .ok()
                .map(Ok)
        }
        // Lagged: a slow client missed events. Skip rather than tear down
        // the connection — the client can re-fetch state on its own.
        Err(_) => None,
    });

    Sse::new(stream).keep_alive(
        KeepAlive::new()
            .interval(Duration::from_secs(15))
            .text("ping"),
    )
}
