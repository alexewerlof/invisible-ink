# Service Worker Lifecycle and State

The MV3 background is a web service worker, not a background page. It is created on demand
and destroyed by the browser at will. Code that assumes a long-lived process fails silently:
no error, no handler, just a handler that never ran.

## Termination Triggers

| Trigger          | Threshold                 | Consequence for generated code                                                    |
| ---------------- | ------------------------- | --------------------------------------------------------------------------------- |
| Idle timeout     | ~30s without an event     | Any in-flight async work past that window is killed.                              |
| Maximum lifespan | ~5 minutes, active or not | Long-lived connections (sockets, polling) are severed; re-establish on next wake. |
| Browser teardown | Session end               | All memory is lost; only persisted storage survives.                              |

**Rule: a worker wake is a cold start.** Declare nothing at module scope that must retain a
value between events. Module scope is re-evaluated on every wake.

## What Survives

Only what you wrote to `chrome.storage`. Everything else — closures, timers, in-memory
caches, module-level counters — is gone.

```js
// Wrong: the counter resets to 0 on every wake.
let scanCount = 0

// Right: write through, read back with an explicit default.
const storageKey = 'scanCount'

async function incrementScanCount() {
	const stored = await chrome.storage.local.get(storageKey)
	const next = (stored[storageKey] ?? 0) + 1
	await chrome.storage.local.set({ [storageKey]: next })
	return next
}
```

The same rule applies to timers. A `setTimeout` scheduled before an idle termination never
fires. Anything that must happen later belongs in `chrome.alarms`, with the alarm handler
able to rebuild its own context from storage.

## Choosing a Storage Area

| Area              | Capacity                                                 | Lifetime                                         | Use for                                                                           |
| ----------------- | -------------------------------------------------------- | ------------------------------------------------ | --------------------------------------------------------------------------------- |
| `storage.local`   | ~10 MB, unlimited with the `unlimitedStorage` permission | Until uninstall                                  | Caches, user settings, blocklists, models, offline data                           |
| `storage.session` | ~10 MB                                                   | In memory; cleared when the browser session ends | Secrets and ephemeral flags that must survive a worker restart but never hit disk |
| `storage.sync`    | ~100 KB total, 8 KB per key                              | Synced across the user's signed-in devices       | Cross-device preferences, lightweight license keys — never bulk data              |

`storage.session` is a better home than a global for tokens and decryption keys: it survives
the 30s idle termination, which a global does not.

## The `storage.session` Access Gotcha

`storage.session` is restricted to trusted contexts — the service worker, the popup and side
panels. A content script calling `chrome.storage.session.get` fails with
`Access to storage is not allowed from this context`.

If a content script genuinely needs it, lower the boundary once at worker startup:

```js
// Only do this when a content script truly needs session storage.
chrome.storage.session.setAccessLevel({
	accessLevel: 'TRUSTED_AND_UNTRUSTED_CONTEXTS',
})
```

Prefer keeping session data in the worker and passing what the page needs over messaging.

## Write Throttling

Storage writes are throttled: `MAX_WRITE_OPERATIONS_PER_MINUTE` is 120 and
`MAX_WRITE_OPERATIONS_PER_HOUR` is 1800. Exceeding either fails the write and populates
`chrome.runtime.lastError`.

Anything high-frequency — scroll position, pointer movement, playback progress — must be
accumulated in memory in the content script and flushed on a debounce:

```js
let pending = null
let flushTimer = null

function queueProgress(progress) {
	pending = progress
	if (flushTimer !== null) return
	flushTimer = setTimeout(() => {
		flushTimer = null
		const snapshot = pending
		pending = null
		void chrome.storage.session.set({ progress: snapshot })
	}, 2000)
}
```

A debounce also protects against the 30s idle termination: the flush is short and completes
inside the window, and losing an update costs at most one debounce interval.
