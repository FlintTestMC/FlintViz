# 002: Failure Payload Decode Has An Unbounded Gzip Expansion Path

Severity: Medium / P2

Confidence: High

CWE: CWE-400 Uncontrolled Resource Consumption

## Affected Code

- `crates/flint-viz/src/api/failure.rs:23`: documents that payloads are capped by request body size.
- `crates/flint-viz/src/api/failure.rs:25`: caps only the encoded HTTP request body at 256 KiB.
- `crates/flint-viz/src/api/failure.rs:43`: accepts unauthenticated JSON input.
- `crates/flint-viz/src/api/failure.rs:44`: passes the attacker-controlled `encoded` value to `flint_core::viz_link::decode`.
- `flint-core` git dependency `b50b4a612deacba479cf3614cd3bbb564052b58d`, `src/viz_link.rs:84`: creates a `GzDecoder`.
- `flint-core` git dependency `b50b4a612deacba479cf3614cd3bbb564052b58d`, `src/viz_link.rs:85`: allocates an output `Vec`.
- `flint-core` git dependency `b50b4a612deacba479cf3614cd3bbb564052b58d`, `src/viz_link.rs:86`: calls `read_to_end` with no decoded-size limit.

## Summary

`POST /api/failure/decode` limits the compressed/base64 request body but not the
decoded gzip output. A small request can force the server to allocate and parse a
much larger JSON payload, and the decoded payload is then serialized back to the
client.

This endpoint is reachable even when flint-viz is started without a test root,
so read-only mode does not remove the DoS surface.

## Validation

I generated a controlled payload whose HTTP request body was 11,043 bytes and
whose decoded `spec.name` field was 8,388,608 bytes.

Generation result:

```text
request_bytes 11043 decoded_name_bytes 8388608
```

Request:

```bash
curl -s -o /tmp/flint-viz-decode-response.json \
  -w 'http_code=%{http_code} size_download=%{size_download} time_total=%{time_total}\n' \
  -H 'Content-Type: application/json' \
  --data-binary @/tmp/flint-viz-decode-bomb.json \
  http://127.0.0.1:17878/api/failure/decode
```

Observed response:

```text
http_code=200 size_download=8388818 time_total=0.037008
```

This confirms the server accepts and fully expands a payload far beyond the
documented request cap. I intentionally kept the proof at 8 MiB to avoid a
disruptive local DoS during validation.

## Attack Path Facts

- Assumption: the attacker can reach the flint-viz HTTP port.
- Exposure: default CLI bind is loopback unless the operator passes `--host 0.0.0.0`; the Docker entrypoint binds `0.0.0.0`.
- Auth scope: public/unauthenticated.
- Attacker input: JSON body field `encoded`.
- Boundary crossed: network client controls compressed bytes consumed by server memory and CPU.
- Mitigations present: encoded request body limit of 256 KiB.
- Missing control: no decoded byte limit, no payload field-size limit, and no streaming parse guard.
- Counterevidence: impact is availability-only and the service is commonly local/dev. That lowers severity from high to medium.

## Remediation

- Add a decoded-size cap around gzip reads, for example by reading through `Read::take(max_decoded_bytes + 1)` and rejecting if the cap is exceeded.
- Add payload-level limits after JSON parse, such as maximum `TestSpec` source/name sizes, maximum timeline entries, and maximum failure count.
- Consider moving decode work to `spawn_blocking` if larger payloads remain supported.
- Add a regression test with a tiny compressed request that expands above the configured decoded-size cap.
