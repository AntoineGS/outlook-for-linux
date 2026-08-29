# Repository Agent Guide

This fork must remain easy to sync with upstream. Treat upstream compatibility as a hard requirement for every feature and change; keep edits narrowly scoped to Outlook behavior and do not make unrelated refactors, renames, file moves, formatting churn, duplicated upstream code, or broad edits.

## Documentation

The local Markdown files under `docs-site/docs/` are authoritative. Read them instead of fetching or relying on web copies.

## Generated Documentation Couplings

- After editing `app/config/options.js`, run `npm run generate-config-docs` and include the generated configuration documentation and schema changes.
- After adding or modifying an IPC channel, add a descriptive comment above its registration, add the channel to `app/security/ipcValidator.js`, run `npm run generate-ipc-docs`, and include the generated IPC documentation.

## Sensitive Values

Never log MQTT broker URLs, usernames, passwords, or topics; email addresses, usernames, or account IDs; authentication tokens, API keys, or credentials; custom service URLs such as `customBackground`; certificate fingerprints or issuer details; SSO/Intune account information; or URL query parameters, which may contain tokens.

## Renderer Testing

Unit tests have no DOM (`node:test` plus `node:vm`, no jsdom). Tests for injected browser scripts should assert on generated source text. To verify renderer behavior, use a throwaway main script with `node_modules/.bin/electron probe.js`, a hidden `BrowserWindow`, and `executeJavaScript`. Create every window up front and run cases in parallel; destroying and reloading windows in a loop produces spurious `ERR_FAILED`.

## Required IPC Initialization

The `trayIconRenderer` and `mqttStatusMonitor` modules must receive `ipcRenderer` during initialization in `app/browser/preload.js`. Do not remove them from the modules requiring IPC, even if redundant: tray icon updates and MQTT status publishing depend on this.

## CI, GitHub, and Releases

- A `BLOCKED` status with every check green can mean the `block develop` ruleset's CodeQL requirement is unmet. Runs from bots and first-time contributors may be `action_required`; use "Approve and run workflows" so CodeQL reports.
- `gh run list` may be refused by the permission classifier; use `gh api repos/{owner}/{repo}/actions/runs` instead.
- A merged release-please PR produces a **draft** release (`releaseType: draft` in `package.json`). It is published by hand, ships as a pre-release, and `releases/latest` keeps pointing at the previous version until it is promoted.
