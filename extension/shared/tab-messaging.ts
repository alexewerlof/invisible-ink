/**
 * Sending commands to the page detector.
 *
 * Both the popup and the service worker need this, and both have to cope with a
 * page that was loaded before the extension did: in that case nothing is
 * listening yet, so the first message fails and we inject the content script and
 * try once more.
 */

import { isCommandResponse, type CommandResponse, type CommandType } from './message-contract'

/** Where the built detector lives inside the extension. */
const contentScriptFile = 'content/hidden-character-detector.js'

/**
 * The main frame of a tab.
 *
 * The toolbar badge and the popup both describe this frame and nothing else, so
 * the number in the toolbar always matches the number in the panel. Without it,
 * a message sent without a `frameId` reaches every frame in the tab: the popup
 * would render whichever frame answered first while the badge kept the count of
 * whichever frame reported last, and the two would disagree.
 */
export const mainFrameId = 0

/** Which frame of the tab a command is aimed at. */
export interface RequestTarget {
	readonly frameId?: number
}

/** The tab the user is looking at, which is the only tab the popup can talk to. */
export async function getActiveTab(): Promise<chrome.tabs.Tab | null> {
	const [tab] = await chrome.tabs.query({ active: true, currentWindow: true })
	return tab ?? null
}

/**
 * Schemes only the browser itself owns: settings and history pages, the new tab
 * page, extension pages, view-source and the developer tools.
 */
const restrictedPageSchemes = new Set([
	'about',
	'brave',
	'chrome',
	'chrome-extension',
	'chrome-search',
	'chrome-untrusted',
	'devtools',
	'edge',
	'opera',
	'view-source',
	'vivaldi',
])

/**
 * Whether a URL names a page that can never host a content script, however the
 * manifest is written. Chrome refuses both `sendMessage` and `executeScript` on
 * these, and the rejection is the only signal it gives, so a caller that already
 * knows the tab's URL can report the page as unsupported instead of provoking a
 * logged error.
 *
 * This is a fast path, not the guard: an ordinary `https://` page can still
 * refuse a content script (the Web Store, a PDF viewer, a page the extension has
 * no host permission for), and `file://` pages depend on the user granting file
 * access, so the caller keeps its fallback for the throw.
 */
export function isRestrictedPageUrl(url: string | undefined): boolean {
	if (url === undefined) return false

	const scheme = /^([a-z][a-z0-9+.-]*):/i.exec(url)?.[1]
	return scheme !== undefined && restrictedPageSchemes.has(scheme.toLowerCase())
}

/**
 * Thrown when a tab cannot host the content script at all.
 *
 * Some origins can never run an extension's code: `chrome://` and `edge://`
 * pages, the extension gallery, PDF viewers, and a page the extension has no
 * permission for. Chrome refuses to inject into them and a rejection is the only
 * signal it gives, so that refusal is an answer rather than a fault. It gets its
 * own type so a caller can show the reader the same "cannot be inspected"
 * message without logging a warning, and without matching Chrome's wording,
 * which is not part of its API.
 */
export class UninspectablePageError extends Error {
	constructor() {
		super('The page cannot host the content script.')
		this.name = 'UninspectablePageError'
	}
}

/**
 * Run a command in a tab and return the detector's response.
 *
 * Throws `UninspectablePageError` when the page cannot host a content script at
 * all (browser pages, the extension gallery, PDF viewers); a caller turns that
 * into a short message. Any other throw is unexpected and worth logging.
 */
export async function requestInTab(
	tabId: number,
	type: CommandType,
	{ frameId = mainFrameId }: RequestTarget = {},
): Promise<CommandResponse> {
	const request = { type }
	const options = { frameId }

	let answer: unknown
	try {
		answer = await chrome.tabs.sendMessage(tabId, request, options)
	} catch {
		// Nothing was listening, which means the page was loaded before the
		// extension was. Inject the detector and ask once more; if this fails the
		// page genuinely cannot host a content script and the caller reports it.
		await injectContentScript(tabId, frameId)
		answer = await chrome.tabs.sendMessage(tabId, request, options)
	}

	if (!isCommandResponse(answer)) {
		throw new Error('The page detector answered with an unexpected response.')
	}

	return answer
}

async function injectContentScript(tabId: number, frameId: number): Promise<void> {
	try {
		await chrome.scripting.executeScript({
			target: { tabId, frameIds: [frameId] },
			files: [contentScriptFile],
		})
	} catch {
		// A refusal here means the page can never run the detector. Every other
		// execution failure is left as it is so the caller can tell them apart.
		throw new UninspectablePageError()
	}
}

/**
 * Run a self-contained function inside one frame of a tab.
 *
 * `func` is serialized and injected, so it cannot close over anything from this
 * module: everything it needs has to arrive in `args`. Unlike `tabs.sendMessage`,
 * a frame id that no longer exists makes this reject, which is the answer a
 * caller wants when it is acting on a specific frame.
 */
export async function runInFrame<Args extends unknown[]>(
	tabId: number,
	func: (...args: Args) => unknown,
	args: Args,
	{ frameId = mainFrameId }: RequestTarget = {},
): Promise<void> {
	await chrome.scripting.executeScript({
		target: { tabId, frameIds: [frameId] },
		func,
		args,
	})
}
