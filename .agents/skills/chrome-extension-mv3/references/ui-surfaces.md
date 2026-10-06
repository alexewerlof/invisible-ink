# UI Surfaces: Badge, Context Menus, Popup, Side Panel

## Badge

`chrome.action` replaces both MV2 `browserAction` and `pageAction`. The badge is the cheapest
way to show state.

- Text is capped at **4 characters**; longer values are truncated, so format before setting.
- Always scope to a tab when the number describes that tab. Tab-scoped badges are cleared by
  the browser on navigation, so there is no teardown bookkeeping to write.

```js
const badgeBackgroundColor = '#8a5a00'
const badgeTextLimit = 999

async function updateBadge(tabId, total) {
	const text = formatBadgeCount(total)

	try {
		await chrome.action.setBadgeText({ tabId, text })
		if (text !== '')
			await chrome.action.setBadgeBackgroundColor({
				tabId,
				color: badgeBackgroundColor,
			})
	} catch (error) {
		// The tab can be gone by the time the page answers.
		console.warn('[Invisible Ink] could not update the badge', error)
	}
}

function formatBadgeCount(total) {
	if (total <= 0) return ''
	return total > badgeTextLimit ? `${badgeTextLimit}+` : String(total)
}
```

A tab-scoped badge still needs clearing when the _tab_ stays put but the content changes —
for example on reload, where the old count is stale:

```js
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === 'loading') void updateBadge(tabId, 0)
})
```

## Context Menus

The worker restarts often. Creating menus at module scope succeeds once and then throws
`Cannot create item with duplicate id` on every subsequent wake.

**Create them in an install/startup listener, and clear first so re-entry is safe:**

```js
chrome.runtime.onInstalled.addListener(() => {
	void installContextMenus()
})

chrome.runtime.onStartup.addListener(() => {
	void installContextMenus()
})

async function installContextMenus() {
	await chrome.contextMenus.removeAll()

	for (const menu of menus) {
		chrome.contextMenus.create({
			id: menu.id,
			title: menuTitles[menu.id],
			parentId: menu.parentId,
			contexts: ['page', 'selection', 'editable'],
		})
	}
}
```

If the menu must reflect runtime data, `removeAll()` then recreate inside the same guard —
never per-message.

Handler side: map the menu id to an action, and guard the tab/frame ids before sending,
because a click can arrive for a frame that has since gone away.

```js
chrome.contextMenus.onClicked.addListener((info, tab) => {
	void handleContextMenuClick(info, tab)
})

async function handleContextMenuClick(info, tab) {
	const type = menuCommands[info.menuItemId]
	if (type === undefined || tab?.id === undefined) return

	try {
		await requestInTab(tab.id, type, { frameId: info.frameId })
	} catch (error) {
		console.warn(`[Invisible Ink] "${info.menuItemId}" is not available on this page`, error)
	}
}
```

## Popup vs Side Panel

|          | Popup (`default_popup`)                   | Side panel (`chrome.sidePanel`)                 |
| -------- | ----------------------------------------- | ----------------------------------------------- |
| Lifetime | Closes on any outside click or focus loss | Persists across tab navigation                  |
| Size     | Fixed by content                          | User-resizable width only                       |
| State    | Must be rebuilt on every open             | Survives while open                             |
| Best for | Short, single-action controls             | Continuous tasks: chat, outlines, live analysis |

**Popup rules.** It is destroyed every time it closes, so it must load state on open
(`DOMContentLoaded`, not module scope) and must never be the only holder of unsaved state.
It also cannot be given a target tab — query for the active tab each time.

**Side panel rules:**

- Requires the `"sidePanel"` permission in the manifest.
- Open it either implicitly with
  `chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })`, or explicitly with
  `chrome.sidePanel.open({ tabId })` from a gesture such as a context menu click or command.
- `chrome.sidePanel.close()` exists as of Chrome 141; before that there was no programmatic
  close.
- Tracking open/closed state is unreliable: `chrome.runtime.getContexts()` can return
  `{ windowId: -1 }` for side panel contexts. Derive your own state from user actions instead
  of polling for the panel.
- Width is user-controlled and cannot be set programmatically — design responsively.
- Enable per site with `chrome.sidePanel.setOptions({ tabId, enabled: false })` to collapse
  the panel where it does not apply.

## Checklist

- [ ] Badge text is formatted to ≤4 characters before being set.
- [ ] Badge updates are tab-scoped, and stale counts are cleared on reload.
- [ ] Menus are created in `onInstalled` / `onStartup` after `removeAll()`.
- [ ] Menu click handlers validate `tab.id` and `frameId` before messaging.
- [ ] A popup re-reads its state on every open.
- [ ] Side panel width assumptions do not exist in the layout.
