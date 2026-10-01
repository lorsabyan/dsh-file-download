# Compatibility and troubleshooting

## Supported baseline

The initial release is qualified against **DeepSeek Harness 0.2.0-rc.2**, web profile. Newer versions are unverified until recorded in the changelog. The plugin is a prebuilt bundle for Harness's browser ModuleLoader and Cordis plugin system.

The host must provide:

- `remote.workspaceFiles.stat()` and ranged `readBytes()` with native result envelopes and file identity metadata.
- The `sidebar.right.tab.document.actions` slot.
- Files rows with `data-files-entry="file"` and `data-files-path`, inside a `data-sidebar-right-session` owner.
- Harness's shared React module and the client packages listed in `package.json`.

Folder rows and other filesystem entries do not receive download controls. Files-tree integration uses a DOM adapter because this Harness version has no per-file action slot. The preview uses the public slot API. A future host-provided file action slot should replace the adapter.

## Browser behavior

The ordinary download path buffers at most 32 MiB of file contents before creating a Blob. Browser/RPC overhead and Blob creation can add memory beyond that amount. At most two transfers run concurrently.

Files above 32 MiB use `window.showSaveFilePicker()` and a writable file stream. This API requires a supported browser, a secure context, user activation, and browser permission. Chrome and Edge support this path in suitable contexts. Check the API's availability in your environment rather than relying solely on the browser name.

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

## Upstream references

- [Harness plugin publishing and profile layers](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/develop/basic/publish.md)
- [Native Files rows](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar-files/src/client/FilesBody.tsx)
- [Native preview slot](https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/client/ui-sidebar-documentpreview/src/client/index.ts)
