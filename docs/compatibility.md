# Compatibility and troubleshooting

## Supported baseline

The initial release is qualified against **DeepSeek Harness 0.2.0-rc.2**, web profile. Newer versions are unverified until recorded in the changelog. The plugin is a prebuilt bundle for Harness's browser ModuleLoader and Cordis plugin system.

The host must provide:

- `remote.workspaceFiles.stat()`, ranged `readBytes()`, and `list()` with native result envelopes and file identity/listing metadata.
- The `sidebar.right.tab.document.actions` and `sidebar.right.tab.files.actions` slots.
- Files rows with `data-files-entry="file"` or `"directory"` and `data-files-path`, inside a `data-sidebar-right-session` owner.
- Harness's shared React module and the client packages listed in `package.json`.

File and folder rows receive download controls; other entry types do not. Row integration uses a DOM adapter because this Harness version has no per-entry action slot. Preview and Files-toolbar controls use public slot APIs. A future host-provided entry action slot should replace the adapter.

## Browser behavior

The ordinary download path buffers at most 32 MiB of file contents before creating a Blob. Browser/RPC overhead and Blob creation can add memory beyond that amount. At most two transfers run concurrently.

Files above 32 MiB use `window.showSaveFilePicker()` and a writable file stream. This API requires a supported browser, a secure context, user activation, and browser permission. Chrome and Edge support this path in suitable contexts. Check the API's availability in your environment rather than relying solely on the browser name.

Folder downloads use the save picker on the original click whenever available, before enumeration can expire user activation. They open a writer only after the archive plan passes validation. Without this API, the complete ZIP including headers must fit the 32 MiB buffer limit.

Safari, Firefox, embedded browsers, browser policy, or insecure HTTP may lack the save picker. Smaller downloads still use standard Blob downloads where supported. Larger downloads show an error instead of allocating an unbounded buffer.

Browser preferences determine the small-file destination and whether a Save dialog appears. The plugin does not select a folder automatically. For small files, “Download started” means the browser accepted the download request; the page cannot confirm completion of a later browser Save dialog.

## Troubleshooting

| Symptom                                  | Check                                                                                                                  |
| ---------------------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| No buttons after installation            | Use the same `DSH_HOME` and profile as the web server; verify the bundle in `--dump-config`, then restart and refresh. |
| Preview has a button, Files does not     | Check the supported Harness version and native Files row attributes.                                                   |
| A large file asks for another click      | Click Download again. The second click opens the picker before another metadata request.                               |
| A large file reports unsupported browser | Use a secure Chrome/Edge context with a permitted save picker.                                                         |
| Download reports a changed file          | Wait for the generating task to finish, then retry.                                                                    |
| Permission or disconnect error           | Check existing Harness authentication, file permissions, and connectivity.                                             |

Errors abort the destination where supported. Browser and filesystem implementations control whether a selected destination remains after cancellation. Do not treat this plugin as an atomic filesystem transaction across every browser.

The plugin downloads the original file. A broken DOCX/XLSX/PDF preview or missing document converter is a separate Harness capability and is not repaired by this plugin.

## Folder archives

ZIPs include the selected top-level folder, regular files, hidden files, nested folders, and empty folders. They use standard UTF-8 ZIP names, CRC-32 checksums, stored contents, and streaming data descriptors. Files are not recompressed. The file service supplies no modification times or permission metadata, so ZIP entries use January 1, 1980 and do not preserve permissions.

Limits are fewer than 4 GiB total ZIP bytes, at most 10,000 entries (including directory records and the root), at most 64 directory levels below the selected root, and 8 MiB of ZIP header/name metadata. ZIP64 and compression are not implemented.

Harness's `list` remains workspace-scoped and has its own entry cap (2,000 per directory by default). This release has no listing pagination. A `truncated` listing stops the download with an instruction to raise the host's `maxEntries` setting. It never creates an archive from only the returned prefix.

The archive also stops on unreadable files, native symlink refusals, special entries, duplicate listing names, or unsafe ZIP path components. Names containing path separators, colons, control characters, invalid Unicode, `.` or `..` cannot be archived. No file is silently skipped.

Every file retains the existing per-chunk identity checks. Before closing the ZIP, the plugin relists all included directories and restats all files to detect observed additions, removals, and content changes. This is a best-effort consistency check, not an atomic snapshot or a server-side lock.

## Upstream references

- [Harness plugin publishing and profile layers](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [Native Files rows](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar-files/src/client/FilesBody.tsx)
- [Native preview slot](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar-documentpreview/src/client/index.ts)
