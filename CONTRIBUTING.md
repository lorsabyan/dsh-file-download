# Contributing

Bug reports and focused pull requests are welcome. For a substantial change, open an issue first so its host compatibility and behavior can be discussed.

## Local workflow

Use Node.js 22.22.2 or newer:

```sh
npm ci
npm run build
npm run check
```

After changing source, include the rebuilt `lib/` modules in your pull request. Keep dependency versions pinned and update `package-lock.json` deliberately. Run `npm run format` to apply the repository's formatting.

Add a behavioral test when changing transfer safety, UI lifecycle, or packaging. Avoid tests that only duplicate implementation details. For host integration changes, record the exact Harness/browser versions and perform the manual checks in [validation](docs/validation.md).

## Scope

The plugin saves original regular files through Harness's existing authenticated file service. Keep the shared React external, the server entry minimal, and memory use bounded. A host-provided per-file action slot is preferred over expanding the Files DOM adapter.

File conversion, folder archives, and new server file routes require a separate design discussion. Changes that broaden file access, introduce telemetry, or upload file content need an explicit security review.

## Reporting issues

Include the plugin version, Harness version, browser/version, approximate file size, and whether the problem occurs in Files or preview. Reproduce with a harmless fixture. Remove credentials, private paths, hostnames, and document content from logs and screenshots.

Use [SECURITY.md](SECURITY.md) for sensitive issues. Contributors are expected to communicate respectfully, explain tradeoffs clearly, and help others reproduce findings.
