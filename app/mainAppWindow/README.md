# Main App Window

Manages the primary BrowserWindow that hosts the Teams web interface.

## Components

- **[index.js](index.js)**: Entry point and window lifecycle management
- **[browserWindowManager.js](browserWindowManager.js)**: Window creation, configuration, and event handling
- **[outlookAdCss.js](outlookAdCss.js)**: Delivers only the fixed Outlook ad-suppression stylesheet to an approved main frame.
- **[outlookMainDocumentRuntimeInjector.js](outlookMainDocumentRuntimeInjector.js)**: Delivers only the generated browser Vim runtime to an approved main frame when Vim is enabled.

## Responsibilities

- Window state management (minimize, maximize, close)
- Web contents configuration and security settings
- Integration with Teams web interface
- Call event handling and screen sharing coordination

## Outlook Main-Document Delivery

Outlook's ad suppression and Vim editing have deliberately separate delivery
paths. This keeps the fixed CSS concern independent from the opt-in Vim
runtime: an ad-style failure must not prevent Vim initialization, and a Vim
bundle/configuration failure must not prevent the ad stylesheet attempt.

### Exact lifecycle and target

For both the root window and each profile `WebContentsView`, delivery occurs
only on Electron's `did-frame-finish-load` event. The handler returns for a
non-main frame; for a main frame it resolves the exact target with
`webFrameMain.fromId(frameProcessId, frameRoutingId)`. It then starts
`applyOutlookAdCss(frame)` and
`injectOutlookMainDocumentRuntime(frame, config)` independently. Each promise
is intentionally fire-and-forget with its own failure handling, so neither
operation blocks or retries the other.

Before either operation can execute, the target must be an attached,
non-destroyed `WebFrameMain` whose URL has all of these properties:

- HTTPS;
- an approved Outlook application host;
- no username or password (userinfo); and
- no explicit port (the default HTTPS port only).

The gate is checked again immediately before frame execution to avoid acting
on a frame that navigated or detached during setup.

### Payloads and browser boundary

`outlookAdCss.js` constructs a fixed, data-free script containing only the
known style ID and ad CSS. Both values are JSON-stringified before embedding,
then the script adds an inline `<style>` element if it is not already present.
It does not read or serialize page, profile, account, or message data.

`outlookMainDocumentRuntimeInjector.js` reads the generated browser IIFE only
when `shortcuts.vim.enabled` is exactly `true`. It requires exactly one
configuration token, replaces it with the fixed JSON-stringified Vim-only
configuration, and executes the resulting browser bundle in the approved main
frame. Ad CSS is not bundled into this payload.

The CSS path depends on the approved Outlook document allowing inline style
elements under its CSP. Do not rewrite or relax CSP to make this work. Native
`insertCSS` was live-tested during the investigation, but its stylesheet was
absent from the final persisted-profile document; the final live PASS used the
exact `WebFrameMain` delivery described above.

### Non-goals and safety rules

Do **not** replace this narrow mechanism with:

- CSP rewriting;
- CDP-based production delivery;
- retries, timers, or delayed reinjection; or
- frame discovery or frame-tree scans.

These approaches either broaden the security boundary or make target/lifecycle
selection non-deterministic. Failures are intentionally contained to the
individual ad-CSS or Vim-runtime operation and are retried only by a later,
new main-frame load event.
