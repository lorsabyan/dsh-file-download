# Security policy

## Supported versions

Security fixes are provided for the latest `0.1.x` release. Supported Harness and browser baselines are listed in [compatibility](docs/compatibility.md).

## Reporting a vulnerability

Use the repository's [private vulnerability reporting](https://github.com/lorsabyan/dsh-file-download/security/advisories/new) when available. If unavailable, open an issue requesting a private reporting channel **without publishing sensitive details**.

Provide the affected plugin/Harness versions, reproduction steps using harmless files, and the expected versus actual behavior. Do not include credentials, private file content, or details of an exposed production system.

Reports will be reviewed on a best-effort basis. This independent project does not offer a guaranteed response time.

## Security model

- File access uses the existing authenticated Harness Remote and inherits its permissions.
- The plugin adds no server endpoint, path confinement, or additional authorization policy.
- File identity and chunk validation prevent completing known mixed-version or incomplete transfers.
- Small-file buffering is limited to 32 MiB per transfer; larger files require browser streaming support.
- File content stays between the Harness host and the requesting browser; the plugin sends no analytics or uploads to external services.

Issues in Harness's underlying file service should also be reported through Harness's own security process.
