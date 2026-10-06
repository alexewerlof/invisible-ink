---
name: chrome-extension-mv3
description: 'Generate Chrome Extension Manifest V3 code that survives the ephemeral service worker: state rehydration, chrome.scripting injection into ISOLATED/MAIN worlds, async messaging with `return true`, badge/context-menu/side-panel UI, offscreen documents and declarativeNetRequest rules. USE FOR: writing or extending MV3 background service workers, content scripts, popups, side panels, offscreen documents, DNR rulesets, or manifest.json entries; adding a new extension feature or permission. DO NOT USE FOR: Manifest V2 code, general web JavaScript, or non-extension browser APIs.'
argument-hint: 'Describe the MV3 feature to build (surface, execution world, storage, permissions)'
---

# Chrome Extension Manifest V3

Generate MV3 extension code that behaves deterministically in a volatile execution
environment. In MV3 the background is an **ephemeral service worker**: it is killed after
~30s idle and force-terminated after 5 minutes, so every design decision below exists to
survive a process that may vanish between any two lines.

## When to Use

- Adding a feature to an existing MV3 extension (service worker, content script, popup, side panel).
- Writing a new manifest, permission set, or `web_accessible_resources` entry.
- Injecting into a page, especially when the page's own JavaScript must be touched (`world: 'MAIN'`).
- Wiring message passing between popup, service worker, and page.
- Adding an offscreen document or a `declarativeNetRequest` ruleset.

This file is the procedure and the rules. Depth lives in the reference files linked from each step.

## Answer These Before Writing Code

| Question                    | Why it decides the design                                                           |
| --------------------------- | ----------------------------------------------------------------------------------- |
| Which execution world?      | `ISOLATED` keeps `chrome.*` but not page variables; `MAIN` is the reverse.          |
| Which storage area?         | `local` / `session` / `sync` differ in capacity, persistence and who may read them. |
| Who initiates, who answers? | Determines which side needs `return true` and which side needs a retry.             |
| Which UI surface?           | Popup closes on blur; side panel persists. Badge is per-tab and self-clearing.      |
| Minimum permissions?        | Anything not needed at install time belongs in `optional_permissions`.              |

## Procedure

1. **Declare intent in `manifest.json` first.** Add permissions, host permissions, the
   background type (this repo uses `"type": "module"`), content script matches, and any
   `web_accessible_resources`. A feature that cannot be declared cannot be built.

2. **Register every listener at the top level of the service worker, synchronously.**
   Listeners registered inside `async` callbacks or after an `await` are missed when the
   worker is woken for that event. See [lifecycle-and-state.md](./references/lifecycle-and-state.md).

3. **Externalize all state.** No module-level variable may be treated as durable. Write
   through to `chrome.storage` and rehydrate on wake. See
   [lifecycle-and-state.md](./references/lifecycle-and-state.md).

4. **Create one-time UI in `onInstalled`, never at module scope.** Context menus created
   at the top level throw `Cannot create item with duplicate id` on the next worker wake.
   See [ui-surfaces.md](./references/ui-surfaces.md).

5. **Route messages through a shared contract module** so type strings have a single
   source of truth, and `return true` from every async listener. See
   [messaging.md](./references/messaging.md).

6. **Handle injection timing explicitly.** Assume the page loaded before the extension
   did, and that `document_start` registration can lose a race. See
   [injection.md](./references/injection.md).

7. **Add the UI surface** — badge, context menu, popup, or side panel — sized for what it
   actually supports. See [ui-surfaces.md](./references/ui-surfaces.md).

8. **Reach for the escape hatches only when the DOM or the network demands it**: offscreen
   documents for DOM APIs, `declarativeNetRequest` for request interception. See
   [offscreen-documents.md](./references/offscreen-documents.md) and
   [network-dnr.md](./references/network-dnr.md).

9. **Run the compliance pass** in [compliance.md](./references/compliance.md) before
   calling the work done — CSP, `web_accessible_resources`, least privilege.

## Hard Rules

- **Never** hold durable state in a global. The worker's memory is destroyed between events.
- **Never** `eval()` or `new Function()`, and never load JavaScript from a CDN. MV3 bans
  remotely hosted code.
- **Never** create context menus outside `onInstalled` / `onStartup`.
- **Never** leave an offscreen document open after its task completes.
- **Always** `return true` from an async `onMessage` listener that calls `sendResponse`.
- **Always** wrap `chrome.tabs.sendMessage` in `try`/`catch` — the receiver may not exist.
- **Always** re-check the target before messaging: restricted origins (`chrome://`, the Web
  Store, PDF viewers) cannot host content scripts.
- **Always** keep the target tab's lifecycle in mind: a tab-scoped badge is cleared
  automatically on navigation, a global one is not.

## Repository Conventions

This repo is TypeScript, bundled into `dist/` by Vite (`npm run build`). Chrome loads
`dist/`, never the sources.

- Tabs for indentation, single quotes, no trailing semicolons.
- Strict types with no escape hatches: `tsc --noEmit` and `eslint` must both pass, and the
  lint configuration forbids unsafe `any` rather than allowing a suppressions comment.
- The service worker is an ES module (`"type": "module"` in the manifest), so `import` /
  `export` work directly in `background/service-worker.ts`.
- `shared/message-contract.ts` is the single source of truth for message type strings, the
  shape of request/response payloads, and the runtime guards that narrow an untrusted
  message (`isCommandRequest`, `isCommandResponse`, `isReportMessage`). Add a type there
  before using it anywhere.
- `shared/tab-messaging.ts` owns the send-then-inject-and-retry pattern via
  `requestInTab(tabId, type, { frameId })`. Reuse it instead of writing a new
  `chrome.tabs.sendMessage` call.
- Files open with a docblock explaining the module's responsibility, and comments explain
  _why_ a decision was made rather than restating the code.
- Types are exported from the modules themselves, not expressed as JSDoc.
- The content script is bundled as one classic script. A content script cannot use `import`,
  so `content/hidden-character-detector.ts` is built as an IIFE with the shared modules inlined;
  there is no bootstrap and no `web_accessible_resources` entry.
- `manifest.json` is copied into `dist/` unchanged, so the paths in it name the built files
  (`.js`) while the sources beside it are `.ts`. Bundles are unhashed for that reason.

## Verification Checklist

- [ ] Every listener is registered synchronously at the top level.
- [ ] Every state read on wake is rehydrated from `chrome.storage`, with a documented default.
- [ ] Every async message listener returns `true`.
- [ ] Every `tabs.sendMessage` call tolerates a missing receiver.
- [ ] Context menus are created only in `onInstalled` / `onStartup`, after `removeAll()`.
- [ ] Any offscreen document is guarded by `getContexts` and closed when finished.
- [ ] `manifest.json` permissions are the minimum set; the rest are optional.
- [ ] No remote code, no `eval`, no inline scripts.
- [ ] New strings live in `shared/message-contract.ts`, not inline at the call site.
- [ ] `npm run check-build` passes: every manifest path exists, the content script is a
      classic script, and no bundle contains `eval` or a remote URL.
