/**
 * The page detector: scans the text of the current page, reveals hidden
 * characters as visible markers, restores them, or removes them.
 *
 * This is the file `manifest.json` registers as a content script. Vite bundles it
 * into one self-contained classic script, so the shared modules it imports are
 * inlined and the page never has to fetch anything.
 */

import {
	isCommandRequest,
	messageType,
	type CommandResponse,
	type CommandType,
	type FocusState,
	type ReportMessage,
	type ScanResult,
} from '../shared/message-contract'
import { prefersReducedMotion } from '../shared/dom'
import {
	activeMarkClass,
	collectMarkElements,
	createMarkedFragment,
	markReplacement,
	nextMarkIndex,
} from '../shared/hidden-character-mark'
import {
	countHiddenCharacters,
	joinCleanSegments,
	mergeScanReports,
	scanText,
	splitTextByHiddenCharacters,
	type HiddenCharacterReport,
} from '../shared/hidden-character-scan'

declare global {
	/** Set by the first run of this script in a document. See the bottom of the file. */
	var __invisibleInkLoaded: boolean | undefined
}

/** Elements whose text is never prose, so walking into them only wastes time. */
const skippedTagNames: ReadonlySet<string> = new Set(['SCRIPT', 'STYLE', 'NOSCRIPT', 'TEXTAREA', 'TITLE'])

/** The number of characters a command touched. */
interface ChangeResult {
	readonly changed: number
}

/** Reads the page */

/**
 * Every text node that could hold hidden characters.
 *
 * Editing boxes are skipped on purpose: rewriting the DOM inside a
 * `contenteditable` breaks the editor state of the site, and chat responses are
 * ordinary elements anyway. Form fields never appear here at all, for a
 * different reason: an `<input>` or `<textarea>` keeps its text in its `value`
 * property rather than in a text node, so `SHOW_TEXT` has nothing to walk.
 */
function collectTextNodes(): Text[] {
	const walker = document.createTreeWalker(documentRoot(), NodeFilter.SHOW_TEXT, {
		acceptNode(node: Node): number {
			const parent = node.parentElement
			if (parent === null) return NodeFilter.FILTER_REJECT
			if (skippedTagNames.has(parent.tagName)) return NodeFilter.FILTER_REJECT
			if (parent.isContentEditable) return NodeFilter.FILTER_REJECT
			return node.nodeValue === '' ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT
		},
	})

	const nodes: Text[] = []
	while (walker.nextNode()) {
		// `SHOW_TEXT` means every node here is a Text; the check is what tells the
		// compiler so, since the walker types its result as a plain Node.
		const { currentNode } = walker
		if (currentNode instanceof Text) nodes.push(currentNode)
	}

	return nodes
}

/**
 * The root the walker starts from.
 *
 * This asks for the body rather than reading `document.body` because lib.dom
 * types that property as always present, which is only true for HTML: `<all_urls>`
 * matches SVG and XML files too, and those have no body, so the fallback to the
 * document element is real rather than defensive noise.
 */
function documentRoot(): HTMLElement {
	return document.querySelector('body') ?? document.documentElement
}

/**
 * Measure the page as it is right now.
 *
 * Markers count as findings too: a revealed character is still a hidden
 * character, so the counter does not drop to zero just because the reader can
 * now see it.
 */
function scanPage(): ScanResult {
	const findings: HiddenCharacterReport[] = []

	for (const node of collectTextNodes()) {
		const report = scanText(node.nodeValue ?? '')
		if (report.total > 0) findings.push(report)
	}

	const markElements = collectMarkElements()
	for (const mark of markElements) {
		findings.push(scanText(mark.dataset.iiCharacter ?? ''))
	}

	return {
		report: mergeScanReports(findings),
		sources: findings.length,
		revealedCharacters: markElements.length,
		focus: readFocus(markElements.length),
	}
}

/** Changes the page */

/**
 * Replace every hidden character with a marker that spells out its code point,
 * for example `U+200B`. Replacing instead of inserting keeps the page text
 * intact.
 */
function revealHiddenCharacters(): ChangeResult {
	if (collectMarkElements().length > 0) return { changed: 0 }

	let revealed = 0

	for (const node of collectTextNodes()) {
		const segments = splitTextByHiddenCharacters(node.nodeValue ?? '')
		const hidden = countHiddenCharacters(segments)
		if (hidden === 0) continue

		node.replaceWith(createMarkedFragment(segments))
		revealed += hidden
	}

	return { changed: revealed }
}

/** Put the markers back to the characters they replaced. */
function hideRevealedCharacters(): ChangeResult {
	const markElements = collectMarkElements()
	for (const mark of markElements) {
		mark.replaceWith(mark.dataset.iiCharacter ?? '')
	}
	focusedIndex = -1
	return { changed: markElements.length }
}

/**
 * Delete the hidden characters, whether they are visible as markers or not.
 *
 * A space look-alike is left as an ordinary space rather than deleted, because
 * the reader saw a space there and removing it would run two words together.
 */
function removeHiddenCharacters(): ChangeResult {
	let removed = 0

	for (const mark of collectMarkElements()) {
		mark.replaceWith(markReplacement(mark))
		removed += 1
	}

	for (const node of collectTextNodes()) {
		const segments = splitTextByHiddenCharacters(node.nodeValue ?? '')
		const hidden = countHiddenCharacters(segments)
		if (hidden === 0) continue

		node.nodeValue = joinCleanSegments(segments)
		removed += hidden
	}

	focusedIndex = -1
	return { changed: removed }
}

/** Walks the reader through the findings */

/**
 * The index of the marker the reader was last taken to, in document order, or
 * -1 when nothing is highlighted. It lives in the page and not in the popup
 * because the popup is rebuilt every time it opens, while the page keeps the
 * markers the index points at.
 */
let focusedIndex = -1

/** Reveal the page if it is still hidden, then highlight one finding. */
function focusRequest(step: number): CommandResponse {
	let changed = 0
	if (collectMarkElements().length === 0) changed = revealHiddenCharacters().changed

	if (step === 0) {
		focusFirstCharacter()
	} else {
		focusRelativeCharacter(step)
	}

	return { ok: true, changed, scan: scanPage() }
}

/** Scroll to the first finding on the page and highlight it. */
function focusFirstCharacter(): void {
	focusedIndex = -1
	focusRelativeCharacter(1)
}

/**
 * Move the highlight one finding forward or back, wrapping around at either end
 * so repeated clicks cycle through every occurrence.
 */
function focusRelativeCharacter(step: number): void {
	const marks = collectMarkElements()
	if (marks.length === 0) {
		focusedIndex = -1
		return
	}

	focusedIndex = nextMarkIndex(focusedIndex, step, marks.length)

	for (const [index, mark] of marks.entries()) {
		mark.classList.toggle(activeMarkClass, index === focusedIndex)
	}

	// `noUncheckedIndexedAccess` types every indexed read as optional, even though
	// `nextMarkIndex` just returned a position inside the array.
	marks[focusedIndex]?.scrollIntoView({
		block: 'center',
		inline: 'center',
		behavior: prefersReducedMotion() ? 'auto' : 'smooth',
	})
}

/**
 * The highlight state to report, or `null` when nothing is highlighted.
 *
 * An index that no longer fits the page is dropped here, so the popup never
 * shows a position that has stopped existing.
 */
function readFocus(markCount: number): FocusState | null {
	if (focusedIndex < 0 || focusedIndex >= markCount) {
		focusedIndex = -1
		return null
	}

	return { index: focusedIndex, total: markCount }
}

/** Answers the popup and the service worker */

const requestHandlers: Record<CommandType, () => CommandResponse> = {
	[messageType.scan]: scanRequest,
	[messageType.reveal]: () => changeRequest(revealHiddenCharacters),
	[messageType.hide]: () => changeRequest(hideRevealedCharacters),
	[messageType.remove]: () => changeRequest(removeHiddenCharacters),
	[messageType.focusFirst]: () => focusRequest(0),
	[messageType.focusNext]: () => focusRequest(1),
	[messageType.focusPrevious]: () => focusRequest(-1),
}

function scanRequest(): CommandResponse {
	return { ok: true, changed: 0, scan: scanPage() }
}

function changeRequest(action: () => ChangeResult): CommandResponse {
	const { changed } = action()
	return { ok: true, changed, scan: scanPage() }
}

/** Turn a handler that throws into the failure answer the callers expect. */
function runHandler(handler: () => CommandResponse): CommandResponse {
	try {
		return handler()
	} catch (error) {
		return { ok: false, reason: error instanceof Error ? error.message : String(error) }
	}
}

/** Hand the toolbar badge the count of the scan we just performed. */
function publishScanForBadge(response: CommandResponse): void {
	if (!response.ok) return

	const request: ReportMessage = {
		type: messageType.report,
		payload: { total: response.scan.report.total, revealedCharacters: response.scan.revealedCharacters },
	}

	// There is usually a service worker listening. When the extension was
	// reloaded while this page stayed open there is not, and the badge simply
	// keeps the count of the previous page.
	void chrome.runtime.sendMessage(request).catch(() => undefined)
}

/**
 * A document can end up with the detector injected twice: the manifest declares it
 * for the main frame, and `requestInTab` injects the same file on demand when the
 * first command arrives before the declared script has run. Registering the
 * listener twice would answer every command twice, so the second run stops here.
 */
if (globalThis.__invisibleInkLoaded !== true) {
	globalThis.__invisibleInkLoaded = true

	chrome.runtime.onMessage.addListener((request: unknown, _sender, sendResponse) => {
		if (!isCommandRequest(request)) return false

		const response = runHandler(requestHandlers[request.type])
		sendResponse(response)
		publishScanForBadge(response)

		// The response is sent synchronously, so the channel does not stay open.
		return false
	})
}
