/**
 * The extension service worker: owns the toolbar badge and the right-click menu,
 * and nothing else. Scanning and rewriting the page belongs to the detector, the
 * messages the detector publishes here are the only thing that moves the badge,
 * and the clipboard write is injected into the clicked frame.
 */

import { isReportMessage, messageType, type CommandType } from '../shared/message-contract'
import { stripHiddenCharacters } from '../shared/hidden-character-scan'
import { mainFrameId, requestInTab, runInFrame, type RequestTarget } from '../shared/tab-messaging'
import { badgeBackgroundColor } from '../shared/theme'

const menuIds = {
	root: 'ii-root',
	reveal: 'ii-reveal',
	hide: 'ii-hide',
	remove: 'ii-remove',
	copyClean: 'ii-copy-clean',
} as const

/** One of the menu entries this extension creates. */
type MenuId = (typeof menuIds)[keyof typeof menuIds]

const menuTitles: Record<MenuId, string> = {
	[menuIds.root]: 'Hidden characters',
	[menuIds.reveal]: 'Reveal hidden characters',
	[menuIds.hide]: 'Restore revealed characters',
	[menuIds.remove]: 'Remove hidden characters',
	[menuIds.copyClean]: 'Copy clean text',
}

/**
 * The action each leaf menu runs. A click arrives with an arbitrary
 * `menuItemId`, so this is a lookup rather than an index into the title table:
 * the root menu is a submenu and deliberately has no action.
 */
const menuCommands = new Map<string | number, CommandType>([
	[menuIds.reveal, messageType.reveal],
	[menuIds.hide, messageType.hide],
	[menuIds.remove, messageType.remove],
])

/** Where a menu can be opened. `contexts` wants a non-empty tuple, not an array. */
type MenuContext = `${chrome.contextMenus.ContextType}`
const pageContexts: [MenuContext, ...MenuContext[]] = ['page', 'selection', 'editable']
const selectionContexts: [MenuContext, ...MenuContext[]] = ['selection']

/** The leaf menus, all of which hang off the root submenu. */
const leafMenus: readonly {
	readonly id: MenuId
	readonly parentId: MenuId
	readonly contexts: [MenuContext, ...MenuContext[]]
}[] = [
	{ id: menuIds.reveal, parentId: menuIds.root, contexts: pageContexts },
	{ id: menuIds.hide, parentId: menuIds.root, contexts: pageContexts },
	{ id: menuIds.remove, parentId: menuIds.root, contexts: pageContexts },
	// Copying works on whatever is selected, so it is offered only then.
	{ id: menuIds.copyClean, parentId: menuIds.root, contexts: selectionContexts },
]

const badgeTextLimit = 999

chrome.runtime.onInstalled.addListener(() => {
	void installContextMenus()
})

chrome.runtime.onStartup.addListener(() => {
	void installContextMenus()
})

/**
 * Menus are created on install and on startup, never at module scope: the worker
 * is restarted constantly and a top-level `create` would throw on the second run.
 */
async function installContextMenus(): Promise<void> {
	await chrome.contextMenus.removeAll()

	chrome.contextMenus.create({ id: menuIds.root, title: menuTitles[menuIds.root], contexts: pageContexts })

	for (const menu of leafMenus) {
		chrome.contextMenus.create({
			id: menu.id,
			title: menuTitles[menu.id],
			parentId: menu.parentId,
			contexts: menu.contexts,
		})
	}
}

chrome.contextMenus.onClicked.addListener((info, tab) => {
	void handleContextMenuClick(info, tab)
})

async function handleContextMenuClick(
	info: chrome.contextMenus.OnClickData,
	tab: chrome.tabs.Tab | undefined,
): Promise<void> {
	if (info.menuItemId === menuIds.copyClean) {
		await copyCleanSelection(info, tab)
		return
	}

	const type = menuCommands.get(info.menuItemId)
	if (type === undefined || tab?.id === undefined) return

	// A menu click names the frame it happened in. Falling back to the main frame
	// keeps that frame the one the badge and the popup describe.
	const target: RequestTarget = info.frameId === undefined ? {} : { frameId: info.frameId }

	try {
		await requestInTab(tab.id, type, target)
	} catch (error) {
		console.warn(`[Invisible Ink] "${String(info.menuItemId)}" is not available on this page`, error)
	}
}

/**
 * Copy the selection with its hidden characters removed.
 *
 * The text comes from the click itself rather than the page: the browser hands
 * over the selection in `info.selectionText`, so this works for a selection in a
 * form field as well as in ordinary page text.
 */
async function copyCleanSelection(
	info: chrome.contextMenus.OnClickData,
	tab: chrome.tabs.Tab | undefined,
): Promise<void> {
	const selected = info.selectionText
	if (selected === undefined || selected === '' || tab?.id === undefined) return

	// A menu click names the frame it happened in. The clipboard write has to run
	// in that frame, where the selection the reader made actually lives.
	const target: RequestTarget = info.frameId === undefined ? {} : { frameId: info.frameId }

	try {
		await runInFrame(tab.id, writeClipboardText, [stripHiddenCharacters(selected)], target)
	} catch (error) {
		console.warn('[Invisible Ink] could not copy the cleaned-up selection', error)
	}
}

/**
 * Runs inside the clicked frame, where a document and `navigator.clipboard`
 * exist. It is serialized and injected, so it has to stay self-contained: no
 * imports, and no closure over anything in this module.
 */
function writeClipboardText(text: string): Promise<void> {
	return navigator.clipboard.writeText(text)
}

chrome.runtime.onMessage.addListener((message: unknown, sender): boolean | undefined => {
	if (!isReportMessage(message)) return undefined

	// The badge describes the main frame, which is what the popup counts. A
	// report from a subframe means the user used the right-click menu inside an
	// iframe, and that count would not match anything the popup can show.
	if (sender.frameId !== mainFrameId) return undefined

	const tabId = sender.tab?.id
	if (tabId === undefined) return undefined

	void updateBadge(tabId, message.payload.total)
	return undefined
})

// A new document starts without any markers, so the previous count is stale.
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
	if (changeInfo.status === 'loading') void updateBadge(tabId, 0)
})

async function updateBadge(tabId: number, total: number): Promise<void> {
	const text = formatBadgeCount(total)

	try {
		await chrome.action.setBadgeText({ tabId, text })
		if (text !== '') await chrome.action.setBadgeBackgroundColor({ tabId, color: badgeBackgroundColor })
	} catch (error) {
		// The tab can be gone by the time the detector answers.
		console.warn('[Invisible Ink] could not update the badge', error)
	}
}

function formatBadgeCount(total: number): string {
	if (total <= 0) return ''
	return total > badgeTextLimit ? `${String(badgeTextLimit)}+` : String(total)
}
