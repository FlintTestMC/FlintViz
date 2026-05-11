# syntax=docker/dockerfile:1.7

# ---- Stage 1: builder ----
# rust:alpine is musl-based, so the resulting binary is fully static
# and runnable on `gcr.io/distroless/static`.
FROM rust:1-alpine AS builder

RUN apk add --no-cache nodejs npm musl-dev

WORKDIR /build

COPY Cargo.toml Cargo.lock ./
COPY .cargo ./.cargo
COPY xtask ./xtask
COPY crates ./crates
COPY frontend ./frontend

RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/build/target \
    --mount=type=cache,target=/build/frontend/node_modules \
    cargo xtask build \
 && cp /build/target/release/flint-viz /flint-viz \
 && strip /flint-viz

# ---- Stage 2: runtime ----
FROM gcr.io/distroless/static-debian12:nonroot

COPY --from=builder /flint-viz /flint-viz

EXPOSE 7878
ENTRYPOINT ["/flint-viz", "serve", "--host", "0.0.0.0"]
