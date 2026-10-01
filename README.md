# File Download for DeepSeek Harness

[![CI](https://github.com/lorsabyan/dsh-file-download/actions/workflows/ci.yml/badge.svg)](https://github.com/lorsabyan/dsh-file-download/actions/workflows/ci.yml)
[![Release](https://img.shields.io/github/v/release/lorsabyan/dsh-file-download)](https://github.com/lorsabyan/dsh-file-download/releases)
[![License: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](LICENSE)

Save any regular file from Harness's **Files tree** or **document preview** with a Download button. Download an entire folder as a **ZIP archive**, including nested files and empty folders. PDF, DOCX, XLSX, text, and binary files retain their original bytes, filename, and extension.

![Illustration of Download actions in the Files tree and preview toolbar](https://raw.githubusercontent.com/lorsabyan/dsh-file-download/main/docs/images/download-actions.svg)

An independent community plugin for [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness). Tested with Harness **0.2.0-rc.2**; maintained separately from DeepSeek.

## Install

Requirements: an existing Harness web installation, its `dsh` CLI, and `pnpm` for plugin management. Run the command on the machine hosting Harness, using the same Harness home and profile as your web server.

1. Download `dsh-file-download-0.2.0.tgz` from [v0.2.0](https://github.com/lorsabyan/dsh-file-download/releases/tag/v0.2.0).
2. From the directory containing that file, install the bundle:

   ```sh
   dsh plugin --profile web add ./dsh-file-download-0.2.0.tgz
   ```

3. Restart your Harness web server and refresh the browser. For a standard CLI installation, start it with `dsh --profile web`.

Replace `web` with the profile you actually use. Custom container deployments must install the bundle in their persistent profile or image; installing it on your laptop does not change a remote server.

The archive includes prebuilt modules. It requires no compiler, document converter, or install-time build permission. `SHA256SUMS` is available alongside every release.

Verify registration:

```sh
dsh --profile web --dump-config
```

The composed configuration should contain the `dsh-file-download` bundle layer. The package is distributed through GitHub releases; it is **not published to npm**.

## Use

- **Files:** select the Download icon beside a regular file. Selecting the filename still opens its native preview.
- **Folders:** select the Download icon beside a folder to save `folder-name.zip`. The folder's expand button still works normally. Use **Download ZIP** in the Files toolbar to archive the current root.
- **Preview:** select **Download** in the preview toolbar. A DOCX preview downloads the original `.docx`; the rendered preview remains available.
- **During a transfer:** select the same button to cancel. Its tooltip shows progress; status messages report completion or errors.

Files up to **32 MiB** use the browser's normal download behavior. Larger files stream to a destination chosen through Chrome or Edge's save dialog. If an initial metadata request expires the browser's click permission, the plugin asks you to click Download once more.

Folder downloads open a save dialog immediately in browsers supporting `showSaveFilePicker`, then stream the ZIP to that destination. Other browsers can download ZIPs up to **32 MiB**, including archive overhead. ZIPs retain the selected folder as their top-level directory and include hidden files. They store original contents without recompression.

Archives must stay below **4 GiB**, **10,000 entries**, **64 nesting levels**, and an **8 MiB ZIP metadata budget**. An incomplete host listing, unreadable file, symlink, unsupported special entry, or source change produces an error instead of a silently incomplete ZIP. See [archive limits](docs/compatibility.md#folder-archives).

Document creation and Markdown-to-PDF conversion require other tools.

## Compatibility

| Environment                           | Files up to 32 MiB      | Files over 32 MiB                 |
| ------------------------------------- | ----------------------- | --------------------------------- |
| Chrome / Edge, secure web context     | Normal browser download | Stream to a selected file         |
| Browsers without `showSaveFilePicker` | Normal browser download | Clear unsupported-browser message |

Actual qualification used Chrome. Other browsers with standard Blob downloads are expected to support the smaller-file path, but have not been manually qualified. See [compatibility and troubleshooting](docs/compatibility.md).

The table describes individual files. Folder ZIPs use the save picker whenever available; their fallback follows the same 32 MiB bound.

Preview and Files-toolbar integration use Harness's official action slots. File and folder rows use a small adapter to the native row attributes. Changes to those attributes may require a plugin update.

## Remove

```sh
dsh plugin --profile web remove dsh-file-download
```

Restart the web server and refresh the browser after removing the bundle.

## Develop

Node.js **22.22.2 or newer** and npm are required for development. React comes from Harness at runtime; development dependencies are used only for building and testing.

```sh
git clone https://github.com/lorsabyan/dsh-file-download.git
cd dsh-file-download
npm ci
npm run build
npm run check
npm run release:pack
```

Release archives and checksums are written to `dist/`. Generated `lib/` modules are committed and checked against source in CI. See [contributing](CONTRIBUTING.md), [architecture](docs/architecture.md), and [validation](docs/validation.md).

## Security and support

Downloads use Harness's existing authenticated file Remote. The plugin introduces no server endpoint, telemetry, external file upload, or additional file-access policy. It inherits the permissions of the Harness installation.

Report ordinary bugs through [issues](https://github.com/lorsabyan/dsh-file-download/issues). Follow [SECURITY.md](SECURITY.md) for sensitive reports. Please omit credentials, private documents, and server addresses from public reports.

MIT licensed. DeepSeek Harness and its trademarks belong to their respective owners. The README illustration is a schematic of the integration, not a screenshot.
