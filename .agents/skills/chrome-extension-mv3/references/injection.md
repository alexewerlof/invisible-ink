# Script Injection and Execution Worlds

Chrome keeps a hard boundary between the extension's JavaScript context and the page's.
Both share the DOM; neither shares variables. Choosing a world is therefore a decision
about _which APIs you need_, and the two choices are mutually exclusive.

| World                | Sees page variables | Sees `chrome.*` | Risk                                                                    |
| -------------------- | ------------------- | --------------- | ----------------------------------------------------------------------- |
| `ISOLATED` (default) | No                  | Yes             | Low. Page cannot read or monkey-patch extension code.                   |
| `MAIN`               | Yes                 | No              | High. Exposed to the page's CSP and to the page sniffing your payloads. |

## Declarative vs Programmatic Injection

- **`content_scripts` in the manifest** — for scripts that run on a known URL set at install
  time. Always `ISOLATED`.
- **`chrome.scripting.executeScript`** — for on-demand injection, for `frameIds` targeting,
  and when a non-default world is required.

```js
await chrome.scripting.executeScript({
	target: { tabId, frameIds: [frameId] },
	files: ['content/hidden-character-detector.js'],
})
```

Note that the path is the _built_ one: the manifest and `executeScript` both name files in
the packaged extension, so a bundle that Vite emits from `content/hidden-character-detector.ts` is
still referenced as `.js`.

To reach page internals, pass `world: 'MAIN'` explicitly — it is never the default:

```js
await chrome.scripting.executeScript({
	target: { tabId },
	world: 'MAIN',
	files: ['content/page-hook.js'],
})
```

## Edge Cases to Code Against

- **CSP applies in the MAIN world.** The page's Content Security Policy governs your script.
  Pages enforcing Trusted Types or omitting `unsafe-eval` will reject dynamic compilation
  and HTML-string sinks. Build DOM with `document.createElement` and set `textContent`,
  never `innerHTML` with interpolated strings. Do not plan on stripping CSP headers — doing
  so broadly is a Web Store policy violation.
- **Namespace collisions across worlds.** Registering the _same_ file in both `MAIN` and
  `ISOLATED` can fail with `SyntaxError: Identifier has already been declared`, because the
  browser's caching mixes namespaces. Give each world its own file identity
  (`page-hook.js` vs `isolated-core.js`) even when the content is similar.
- **`document_start` registration is a race.** Registering a script from the worker to run at
  `document_start` happens asynchronously. If the page paints first, that injection misses the
  initial load entirely and only applies to the next navigation.
- **Ephemeral iframes are not URL-matched.** Frames with `about:blank`, `srcdoc`, or a
  script-generated `src` inherit the parent's origin but do not match normal patterns. Add
  `match_about_blank: true` to the manifest entry or the injection config, or they stay unreached.

## The Two-World Shim

When a feature needs both page variables and extension APIs, generate three pieces rather
than one script with a foot in each world.

1. **Isolated core** (`ISOLATED`): owns `chrome.runtime` messaging and validates input.
2. **Main-world shim** (`MAIN`): touches page globals, intercepts native calls, patches
   prototypes.
3. **A bridge between them**, routed through the shared DOM.

The page can attach listeners to `window` and `document`, so a fixed event name leaks the
whole channel. Generate a random name per session and keep the payload minimal:

```js
// In the isolated core, before the shim loads.
const bridgeChannel = `bridge:${crypto.randomUUID()}`
document.documentElement.dataset.bridgeChannel = bridgeChannel

window.addEventListener(bridgeChannel, (event) => {
	const { requestId, payload } = JSON.parse(event.detail)
	// Validate `payload` as untrusted input before doing anything with it.
	void handleBridgeRequest(requestId, payload)
})
```

Treat every value that crosses the bridge as page-supplied and untrusted, because it is.

## Zero-Flicker Cosmetic Changes

Injection at `document_idle` (or even `document_start` from a sleeping worker) lets the
original DOM paint first, producing a visible layout shift. `chrome.webNavigation.onCommitted`
fires after the frame host swaps but before the DOM is constructed, which is early enough to
insert CSS ahead of the first paint.

```js
chrome.webNavigation.onCommitted.addListener((details) => {
	if (details.frameId !== 0) return
	void chrome.scripting.insertCSS({
		target: { tabId: details.tabId },
		files: ['content/hidden-character-marks.css'],
	})
})
```

This requires the `webNavigation` permission and a matching host permission.

## `chrome.userScripts`

Chrome 120 added `chrome.userScripts` for dynamically registered scripts with explicit
`USER_SCRIPT` or `MAIN` worlds. Two constraints decide against it for most features:

- The user must enable developer mode / "Allow User Scripts" in `chrome://extensions`, which
  is unacceptable onboarding friction for a consumer extension.
- User scripts message over `chrome.runtime.onUserScriptConnect`, not `onMessage`, so they
  need their own handler and parsing path.

Use it only when the product explicitly targets power users.
