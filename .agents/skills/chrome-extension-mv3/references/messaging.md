# Inter-Context Messaging

Message passing between popup, side panel, service worker and content scripts is the most
common source of "it works sometimes" bugs. Almost all of them surface as:

```
Unchecked runtime.lastError: Could not establish connection. Receiving end does not exist.
```

That error means the sender assumed a receiver that was not listening at that instant. There
are three causes, and each has a specific fix.

## Cause 1 — The Listener Did Not Promise to Reply

`sendResponse` is only valid while the listener is still considered active. A synchronous
listener ends when it returns; if it then `await`s something, the channel is already closed
by the time the reply is sent.

```js
// Broken: the channel closes the moment the listener returns.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	void (async () => {
		const data = await loadSomething()
		sendResponse(data)
	})()
})

// Correct: `return true` keeps the channel open until sendResponse runs.
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
	if (message?.type !== messageType.scan) return
	void (async () => {
		try {
			sendResponse({ ok: true, data: await loadSomething() })
		} catch (error) {
			sendResponse({ ok: false, reason: String(error) })
		}
	})()
	return true
})
```

Two corollaries:

- Reply on **every** path, including the failure path. A listener that throws leaves the
  sender awaiting forever.
- Return `undefined` (i.e. nothing) for messages this listener ignores, so a later listener
  can handle them.

## Cause 2 — The Receiver Does Not Exist Yet

The tab was loaded before the extension, or the content script never ran on that origin.
Do not pre-check; make the call idempotent instead. Try, inject, retry:

```js
export async function requestInTab(tabId, type, { frameId } = {}) {
	const request = { type }
	const options = frameId === undefined ? {} : { frameId }

	try {
		return await chrome.tabs.sendMessage(tabId, request, options)
	} catch {
		await injectContentScript(tabId, frameId)
		return chrome.tabs.sendMessage(tabId, request, options)
	}
}
```

This repo already ships that helper as `requestInTab` in `shared/tab-messaging.ts`. Reuse it
rather than writing a bare `chrome.tabs.sendMessage`. The second attempt is intentionally not
wrapped: if injection just failed, the failure is real and the caller should report it.

## Cause 3 — The Receiver Cannot Exist

Some origins can never host a content script: `chrome://` and `edge://` pages, the Chrome Web
Store, PDF viewers, and any page without matching host permission. `executeScript` rejects on
these, so the injection retry above still throws — which is the correct outcome, provided the
caller turns it into a user-facing message rather than an unhandled rejection.

Restricted origins are also why the popup/worker must query the _active_ tab rather than
assume a target:

```js
export async function getActiveTab() {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
	return tab ?? null
}
```

## Designing the Contract

Keep message type strings in one module so a rename is a single edit, and keep the payload
shape next to them. A namespaced value prevents collisions with other extensions' messages on
the same channel:

```ts
const namespace = 'invisible-ink'

export const messageType = {
	scan: `${namespace}:scan`,
	reveal: `${namespace}:reveal`,
	report: `${namespace}:report`,
} as const

/** The messages a page detector answers: everything except the badge report. */
export type CommandType = Exclude<MessageType, typeof messageType.report>

export type CommandResponse =
	| { readonly ok: true; readonly changed: number; readonly scan: ScanResult }
	| { readonly ok: false; readonly reason: string }
```

`@types/chrome` types every message boundary as `any`, so a contract module that stops at
types cannot satisfy a type-aware lint configuration. Ship the narrowing with it, and let the
receiver stay `unknown` until a guard has checked it:

```ts
function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

export function isCommandRequest(value: unknown): value is CommandRequest {
	if (!isRecord(value)) return false

	const { type } = value

	return typeof type === 'string' && knownCommands.has(type)
}
```

Prefer explicit result unions over throwing across the boundary: an error that crosses a
message channel arrives as a stringified blob with the stack already gone.

## Long-Lived Channels

A `chrome.runtime.Port` (`connect` / `onConnect`) is worth the extra code only when traffic
is genuinely streaming. Remember that the worker can die mid-stream: the `onDisconnect`
handler must be able to re-establish the connection and rebuild state from storage — a port
is not a substitute for persistence.

## Checklist

- [ ] Async listeners `return true` and reply on both success and failure.
- [ ] Non-matching messages return early without consuming `sendResponse`.
- [ ] All tab sends tolerate a missing receiver.
- [ ] Message strings come from the shared contract module.
- [ ] Every `await chrome.*` call that can reject is inside `try`/`catch`.
