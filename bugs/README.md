# Bug And CVE Findings

Scan date: 2026-05-28

Scope: repository-wide dependency/advisory sweep plus targeted security review of
the reachable runtime surfaces in this checkout. No application code was changed.

## Findings

| ID | Title | Severity | Status |
| --- | --- | --- | --- |
| 001 | Unauthenticated test API can read and write files under the served root | Medium / P2 | Reproduced |
| 002 | Failure payload decode has an unbounded gzip expansion path | Medium / P2 | Reproduced |
| 003 | CVE-2026-45149 in transitive frontend dependency `brace-expansion` | Low / P3 locally, Moderate upstream | Confirmed by `npm audit` |

## Negative Results

- `cargo-audit` found no RustSec vulnerabilities in `Cargo.lock`.
- `npm audit` found one advisory, covered by finding 003.

## Commands Run

- `npm --prefix frontend audit --json`
- `/tmp/cargo-audit-root/bin/cargo-audit audit --json`
- `cargo tree --locked -p flint-viz`
- Live HTTP reproduction against `./flint-viz serve /tmp/flint-viz-bugscan-root --host 127.0.0.1 -p 17878`

The temporary server and reproduction files were created under `/tmp` and the
server was stopped after validation.
