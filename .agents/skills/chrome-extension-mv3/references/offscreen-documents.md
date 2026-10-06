# Offscreen Documents

A service worker has no DOM. `DOMParser`, the clipboard, `localStorage`, `<canvas>`,
`<audio>` and the rest are unavailable. Instead of pushing that work into a user's tab,
create an invisible document with `chrome.offscreen`.

## One at a Time

An extension may have exactly one offscreen document. A second `createDocument` call is a
fatal error, so always check first:

```js
async function ensureOffscreenDocument() {
	const existing = await chrome.runtime.getContexts({
		contextTypes: ['OFFSCREEN_DOCUMENT'],
	})

	if (existing.length > 0) return

	await chrome.offscreen.createDocument({
		url: 'offscreen.html',
		reasons: [chrome.offscreen.Reason.DOM_SCRAPING],
		justification: 'Parsing scraped HTML into plain text',
	})
}
```

`justification` is shown to users and reviewers — describe the real reason, not "processing".
The `reasons` value must match what the document actually does.

The call is still racy in theory: two messages can both pass the `getContexts` check. Serialize
creation behind a single in-flight promise so concurrent callers share one document.

## Close It

Offscreen documents are **not** subject to the worker's idle termination. Left open, they hold
RAM for the life of the browser session. Close the document as soon as the task is done:

```js
await chrome.offscreen.closeDocument()
```

Pattern: create → message → close, in a `try`/`finally` so an exception cannot leak the document.

## GPU and Memory Traps

Intensive `Canvas2D` or `<canvas>` work in an offscreen document is known to leak. The
document is never composited on screen, so the GPU process can drop frames and fail to
release textures, growing memory until the browser crashes.

- Avoid `requestVideoFrameCallback` loops and continuous canvas rendering offscreen.
- Throttle any unavoidable rendering, and explicitly zero out and drop canvas buffers
  (`canvas.width = 0`) when finished.

## What the Document Can Do

Offscreen documents are sandboxed to `chrome.runtime` messaging. They **cannot** use
`chrome.storage` or `chrome.tabs`. Load your data in the worker and pass it over:

```js
// In the worker.
await ensureOffscreenDocument()
const result = await chrome.runtime.sendMessage({
	type: offscreenMessageType.parse,
	payload: { html },
})
await chrome.offscreen.closeDocument()
return result
```

The offscreen document answers with the same listener contract as any other context — including
`return true` for async replies. Handlers should dispatch on a message type, not assume every
message is theirs, since `runtime.sendMessage` is broadcast to all extension contexts.

## Checklist

- [ ] Creation is guarded by `getContexts`, and concurrent creation is serialized.
- [ ] The document is closed in a `finally` block once its task completes.
- [ ] `reasons` and `justification` describe what the document really does.
- [ ] No heavy or continuous GPU rendering happens offscreen.
- [ ] No `chrome.storage` / `chrome.tabs` calls exist in the offscreen document.
