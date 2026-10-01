# Changelog

Changes follow [Semantic Versioning](https://semver.org/). Harness compatibility is recorded separately because its plugin APIs are still evolving.

## 0.2.0 — 2026-10-01

- Download folders as ZIP archives from directory rows and the current Files-root toolbar.
- Preserve nested paths, hidden files, empty files/folders, Unicode names, and original file bytes.
- Open folder save pickers on the original click and stream entries with destination backpressure; retain a bounded fallback where supported.
- Validate CRC-32, safe names, listing completeness, source identities, directory membership, and ZIP32/entry/depth/metadata limits.
- Add independent ZIP-reader tests and real Harness filesystem-service integration checks, including 40 MiB archives and symlink refusal.

## 0.1.0 — 2026-10-01

Initial public release.

- Download actions for regular files in the Files tree and the native document preview toolbar.
- Original filenames and bytes, including PDF, DOCX, XLSX, Unicode names, and arbitrary binary files.
- Sequential 1 MiB reads, a 32 MiB buffered fallback, and large-file streaming through the browser's save picker.
- Transfer cancellation, source-change detection, accessible button labels, and cleanup on unload.
- Portable Harness bundle, prebuilt release archive, reproducible builds, automated tests, and CI.

Qualified against DeepSeek Harness `0.2.0-rc.2`. See [compatibility](docs/compatibility.md) for browser requirements and integration limits.
