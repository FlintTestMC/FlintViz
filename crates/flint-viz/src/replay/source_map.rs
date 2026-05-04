//! JSON-pointer construction for the replay source map (#0016).
//!
//! Every emitted `SourceSpan` points at a top-level `/timeline/N` entry — see
//! the post-#0012 / post-#0015 handoff in `plan/issues/0016-replay-source-map.md`
//! for why we never split deeper (per-`place_each` placement, per-assert check).
//! This module exists so the RFC 6901 escape helper has one definition rather
//! than being inlined; future deeper-pointer experiments belong here too.

/// Build a JSON pointer for the timeline entry at `idx`. Numeric components
/// never contain `/` or `~`, so no escaping is needed at this level.
pub fn timeline_pointer(idx: usize) -> String {
    format!("/timeline/{}", idx)
}

/// RFC 6901 reference-token escape: `~` → `~0`, `/` → `~1`.
///
/// Order matters: `~` must be replaced before `/`, otherwise the `~` introduced
/// by `/` → `~1` would be re-encoded. The character-by-character implementation
/// below sidesteps that pitfall — every input char produces exactly one output
/// substring in a single pass.
#[allow(dead_code)] // first deeper-pointer caller lands later; keep the helper alongside `timeline_pointer`.
pub fn escape_token(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for ch in s.chars() {
        match ch {
            '~' => out.push_str("~0"),
            '/' => out.push_str("~1"),
            other => out.push(other),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timeline_pointer_uses_decimal_index() {
        assert_eq!(timeline_pointer(0), "/timeline/0");
        assert_eq!(timeline_pointer(42), "/timeline/42");
    }

    #[test]
    fn escape_token_passes_through_plain_strings() {
        assert_eq!(escape_token(""), "");
        assert_eq!(escape_token("checks"), "checks");
        assert_eq!(escape_token("blocks"), "blocks");
    }

    #[test]
    fn escape_token_encodes_tilde_and_slash() {
        assert_eq!(escape_token("a/b"), "a~1b");
        assert_eq!(escape_token("a~b"), "a~0b");
    }

    #[test]
    fn escape_token_does_not_double_encode_synthetic_tildes() {
        // Per RFC 6901 the reverse of "~1" must decode to "/", not be processed
        // a second time. Our single-pass implementation guarantees this — verify
        // explicitly so a future "replace `/` then `~`" refactor would fail.
        assert_eq!(escape_token("/~"), "~1~0");
        assert_eq!(escape_token("~/"), "~0~1");
    }
}
