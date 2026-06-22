# RustSec Audit Result

Status: No RustSec vulnerabilities found

Command:

```bash
/tmp/cargo-audit-root/bin/cargo-audit audit --json
```

Result summary:

```json
{
  "database": {
    "advisory-count": 1098,
    "last-commit": "be6e70abbbc6be4aa1b768b234766d087731da2d",
    "last-updated": "2026-05-27T17:33:53+02:00"
  },
  "lockfile": {
    "dependency-count": 215
  },
  "vulnerabilities": {
    "found": false,
    "count": 0,
    "list": []
  },
  "warnings": {}
}
```

This only covers RustSec advisories known to `cargo-audit`; it does not replace
the code-level findings in this folder.
