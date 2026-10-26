# Main App Window

Manages the primary BrowserWindow that hosts the Teams web interface.

## Components

- **[index.js](index.js)**: Entry point and window lifecycle management
- **[browserWindowManager.js](browserWindowManager.js)**: Window creation, configuration, and event handling
- **[outlookAdCss.js](outlookAdCss.js)**: Delivers only the fixed Outlook ad-suppression stylesheet to an approved main frame.
- **[deepLinkRouter.js](deepLinkRouter.js)**: In-page routing for Teams deep links

## Responsibilities

- Window state management (minimize, maximize, close)
- Web contents configuration and security settings
- Integration with Teams web interface
- Call event handling and screen sharing coordination

## Outlook Main-Document Delivery

Outlook's ad suppression uses a fixed stylesheet delivered to the main document.

### Exact lifecycle and target

For both the root window and each profile `WebContentsView`, delivery occurs
only on Electron's `did-frame-finish-load` event. The handler returns for a
non-main frame; for a main frame it resolves the exact target with
`webFrameMain.fromId(frameProcessId, frameRoutingId)`. It then starts
`applyOutlookAdCss(frame)` with failure handling.

Before the operation can execute, the target must be an attached,
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
ad-CSS operation and are retried only by a later,
new main-frame load event.

## Deep Link Routing

`onAppSecondInstance` navigates the window to a resolved deep link, which
replaces the document and cold-boots the SPA. Launcher links avoid that:
`deepLinkRouter` assigns the equivalent `#/l/...` route to the main frame
instead, guarded by a check on the main frame (the configured origin, or any
known Teams host). The SPA rewrites the fragment or retitles the document when
it handles the route, and anything left unconsumed falls back to the full
navigation — except during a call, where the reload would end it: the link then
waits in `deferredDeepLink` for `teams-call-disconnected`, like a queued auth
recovery. That slot holds one link and the newest navigation wins: a later link
(however it ends up opening), any `did-navigate`, or a queued auth recovery
cancels it, up to the moment it opens. After an in-page route to a chat or a
message, `focusCompose` puts the caret in the compose box (best effort,
selector cascade, only once the view has stopped mutating so the caret never
lands in the chat being left, takes focus back from the highlighted message, backs
off when the user points elsewhere, types into another field or navigates with
the keyboard): the SPA opens the
conversation but leaves focus wherever it was.
