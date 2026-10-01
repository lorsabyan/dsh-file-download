# Architecture

`dsh-file-download` is a client extension with a no-op server entry. Installation adds one Cordis row through `cordis.patch.yml`; `package.json` declares its bundle and browser dependencies. It registers no HTTP routes or model tools.

```mermaid
flowchart LR
  Files[Native Files row] --> UI[Download controller]
  Preview[Official preview action slot] --> UI
  UI --> Remote[Authenticated workspaceFiles Remote]
  Remote --> Read[Sequential 1 MiB reads]
  Read --> Small[Bounded Blob download]
  Read --> Large[Browser writable file stream]
```

## Source boundaries

| File                | Responsibility                                                                                         |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `src/download.mjs`  | Result validation, file identity checks, ranged copies, and a bounded writer.                          |
| `src/client.mjs`    | Row adapter, preview component, transfer lifecycle, browser save APIs, and accessible status messages. |
| `src/index.mjs`     | No-op Cordis server entry.                                                                             |
| `scripts/build.mjs` | Deterministic esbuild output; React stays external and is supplied by Harness.                         |
| `scripts/pack.mjs`  | Validated runtime archive and SHA-256 checksum.                                                        |

## Transfer lifecycle

1. Resolve the original path and owning session. Previews can reference files from a different session; the resource address supplies that owner.
2. Stat the file, retaining its absolute path, version, and byte length.
3. Select a bounded in-memory writer or the browser's writable file stream.
4. Recheck identity and read sequential chunks. Validate each chunk's identity, offset, data type, size, and end marker before writing.
5. Stat again after the final chunk, then close the destination.
6. For small files, pass the completed Blob to the browser with the original basename.

Identity checks reject mixed versions, truncation, and invalid offsets. They depend on the host's version metadata and do not independently lock the source file. `AbortSignal` cancels reads; transfer failures abort the writer. Temporary object URLs are revoked after 60 seconds or on plugin unload.

## UI lifecycle

The row adapter observes added elements and relevant path/session attribute changes. It adds a sibling button without replacing native handlers. Directory navigation is untouched. The official preview slot mounts a React component; unmounting cancels that preview's transfer.

Unloading disconnects the observer, cancels active transfers, removes injected controls and styles, clears timers, and revokes temporary URLs. A shared controller limits concurrency to two transfers.

## Trust boundary

The file Remote is the same authenticated service used by Harness. This plugin adds no sandbox, permission escalation, new authentication mechanism, or path confinement. The underlying host can support absolute paths outside a workspace; this extension inherits that behavior. Buttons act on native regular-file rows or the original file represented by a native preview.

Files are treated as bytes. No content is evaluated or converted, and filenames are assigned through DOM properties rather than inserted as HTML. Status messages use text nodes. There is no analytics or external upload path.
