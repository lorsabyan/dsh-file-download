# Draft: community plugin and per-file action slot

This is a prepared announcement for Harness Discussions. It has not been posted automatically.

**Suggested title:** Community plugin: Download from Files and document previews

I built [dsh-file-download](https://github.com/lorsabyan/dsh-file-download), an independent community plugin that adds Download actions to files and folders in the Files tree and to the native document preview toolbar. Folders download as recursive ZIP archives; the Files toolbar can archive the current root.

It preserves original bytes and filenames, including the original DOCX/XLSX behind a rendered preview. Transfers use the existing authenticated workspaceFiles Remote, sequential 1 MiB reads, cancellation, and file identity checks. Small files use browser downloads; larger files use a supported browser save picker. The prebuilt release installs as a normal Harness bundle.

The initial release is qualified against Harness 0.2.0-rc.2 and Chrome. Source, tests, compatibility notes, and a prebuilt archive are available in the repository, tagged `dsh-plugin`.

The official `sidebar.right.tab.document.actions` slot made preview integration straightforward. Files currently exposes header actions but no per-file action slot, so the plugin uses a small sibling-button adapter on native `data-files-entry="file"` rows.

Would a per-file slot be useful upstream? One possible shape is a list slot such as `sidebar.right.tab.files.file.actions`, scoped to the owning session and receiving `{ absolutePath }`. Naming and placement should follow Harness's own conventions. This would let plugins add download/copy/other actions without depending on native row markup.

Thanks for making the plugin system available. Feedback on compatibility or the proposed slot is welcome.
