# 001: Unauthenticated Test API Can Read And Write Files Under The Served Root

Severity: Medium / P2

Confidence: High

CWE: CWE-306 Missing Authentication for Critical Function, CWE-862 Missing Authorization

## Affected Code

- `crates/flint-viz/src/api/tests.rs:23`: mounts `/api/tests` and `/api/tests/{*id}` without authentication or origin checks.
- `crates/flint-viz/src/api/tests.rs:133`: `load_test` accepts an arbitrary route `id`, resolves it under the root, and reads it.
- `crates/flint-viz/src/api/tests.rs:171`: `write_test` accepts an arbitrary route `id`, resolves it under the root, and overwrites it.
- `crates/flint-viz/src/api/tests.rs:187`: `resolve_under_root` canonicalizes and enforces the root boundary, but does not require `.json`.
- `crates/flint-viz/src/api/tests.rs:201`: `create_test` lets any client create a new `.json` file in existing directories.
- `Dockerfile:32`: the container entrypoint binds the server to `0.0.0.0`.

## Summary

The test API has no authentication, no CSRF/origin defense, and only partial file
type checks. Any client that can reach the server can:

- `GET /api/tests/<id>` and read any existing text file under the configured root, not only test JSON.
- `PUT /api/tests/<id>` and overwrite any existing file under the configured root, not only test JSON.
- `POST /api/tests/<id>.json` and create new JSON files in existing directories.

The root escape guard is present and worked during review, so this is not a path
traversal outside the root. The issue is the missing authentication/authorization
around file read/write operations and the missing `.json` restriction for
existing-file reads/writes.

## Validation

I reproduced this through the real HTTP server.

Setup:

```bash
mkdir -p /tmp/flint-viz-bugscan-root
printf 'SECRET=from-non-json-file\n' > /tmp/flint-viz-bugscan-root/secret.txt
printf '{"name":"ok","timeline":[]}' > /tmp/flint-viz-bugscan-root/ok.json
./flint-viz serve /tmp/flint-viz-bugscan-root --host 127.0.0.1 -p 17878
```

Unauthenticated read of a non-JSON file succeeded:

```bash
curl -i http://127.0.0.1:17878/api/tests/secret.txt
```

Observed response:

```text
HTTP/1.1 200 OK
{"id":"secret.txt","source":"SECRET=from-non-json-file\n","spec":null,"parse_error":"expected value at line 1 column 1"}
```

Unauthenticated overwrite of that non-JSON file succeeded:

```bash
curl -i -X PUT --data 'OVERWRITTEN_BY_UNAUTH_CLIENT' \
  http://127.0.0.1:17878/api/tests/secret.txt
```

Observed response:

```text
HTTP/1.1 204 No Content
```

The file on disk became:

```text
OVERWRITTEN_BY_UNAUTH_CLIENT
```

Unauthenticated create also succeeded with curl's default form content type:

```bash
curl -i -X POST --data '{"name":"created","timeline":[]}' \
  http://127.0.0.1:17878/api/tests/from-post.json
```

Observed response:

```text
HTTP/1.1 201 Created
```

## Attack Path Facts

- Assumption: the attacker can reach the flint-viz HTTP port.
- Exposure: default CLI bind is loopback unless the operator passes `--host 0.0.0.0`; the Docker entrypoint binds `0.0.0.0`.
- Auth scope: public/unauthenticated for the API routes.
- Attacker input: route path `id` and request body.
- Boundary crossed: network client to local filesystem under `test_root`.
- Mitigations present: canonicalization prevents escaping the configured root; create requires `.json`; request bodies are capped at 1 MiB.
- Counterevidence: this is intended as a local developer tool, not an internet service. That lowers severity, but does not defeat the finding for Docker or explicit remote binds.

## Remediation

- Require an explicit token or same-origin session for mutating endpoints.
- Add CSRF/origin checks for `POST` and `PUT`; do not accept simple form posts for writes.
- Reject non-`.json` ids in `load_test` and `write_test`, matching `create_test`.
- Consider defaulting to read-only mode when bound to a non-loopback address unless an explicit `--allow-remote-writes` flag is set.
- Add regression tests for non-JSON `GET` and `PUT` rejection, unauthenticated write rejection, and CSRF/origin behavior.
