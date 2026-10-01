# Validation

## Automated checks

`npm run check` verifies formatting, reproducibility of the committed modules, and the full Node test suite. CI runs it on Node.js 22 and 24, then creates a release archive and checksum. The Node 24 job and release workflow also install the archive into a fresh Harness `0.2.0-rc.2` home, check native authentication and browser registration, and remove the plugin.

Tests cover:

- Binary and Unicode content, empty files, chunk boundaries, and a 40 MiB streamed transfer.
- Changed source versions, malformed metadata, invalid offsets, truncation, disconnects, and cancellation.
- Bounded buffer behavior and writer lifecycle.
- Native open handlers, regular-file filtering, refreshed rows, accessible labels, and owning sessions.
- Preview mounting/unmounting, save-picker gesture retry, unsupported large-file behavior, and plugin unload.
- Browser ModuleLoader registration, portable activation metadata, no-op server activation, and the archive file allowlist.

The DOM tests use jsdom and Harness-shaped service mocks. They cannot prove native Save dialog behavior or compatibility with a future Harness release.

The public `0.1.0` archive also passed the isolated installer/authentication/browser-registration/removal smoke check on Linux ARM64 with Harness `0.2.0-rc.2` and pnpm `10.34.6`. GitHub CI covers Linux x64. Native browser Save behavior remains a manual check.

## Manual qualification

The initial implementation was exercised in an isolated Harness `0.2.0-rc.2` web environment with benign fixtures. Nine Chrome-saved files matched their source SHA-256 hashes: PDF, DOCX, XLSX, text, arbitrary binary, an empty file, a Unicode/spaces filename, a nested text file, and a 40 MiB streamed file.

Native PDF, DOCX, XLSX, and text previews remained usable with the preview Download action. Canceling the large-file picker and retrying after an expired gesture were also exercised. This is evidence for that baseline and browser, not a claim of full cross-browser coverage.

## Release checklist

With Harness and pnpm available on `PATH`, run `npm run test:harness` after packaging. It installs the exact archive into a temporary home, checks native authentication and the browser boot manifest, then removes the plugin. It never uses your existing Harness home. Set `DSH_BIN` if the CLI needs an explicit path.

1. Use a clean checkout, run `npm ci`, rebuild, and run `npm run check`.
2. Run `npm run release:pack`; inspect the archive and verify `SHA256SUMS`.
3. Install the exact archive into an isolated Harness profile using `dsh plugin --profile web add ./archive.tgz`; check its composed configuration and client module registration.
4. Exercise Files and preview actions against benign fixtures, including the original DOCX/XLSX file behind a rendered preview.
5. Review browser limitations and update compatibility notes for any new host baseline.
6. Publish only the allowlisted runtime archive, checksum, and public source. Never include credentials, private fixture data, or deployment configuration.
