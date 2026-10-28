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
	type CommandRequest,
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
	isMarkElement,
	markReplacement,
	nextMarkIndex,
	readMarkedCharacter,
} from '../shared/hidden-character-mark'
import {
	countHiddenCharacters,
	joinCleanSegments,
	mergeScanReports,
	scanText,
	splitTextByHiddenCharacters,
	splitTextByMarkedCharacters,
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
	const revealedCodePoints = new Set<number>()

	for (const node of collectTextNodes()) {
		const report = scanText(node.nodeValue ?? '')
		if (report.total > 0) findings.push(report)
	}

	const markElements = collectMarkElements()
	for (const mark of markElements) {
		const marked = readMarkedCharacter(mark)
		if (marked === null) continue

		findings.push(scanText(marked.value))
		revealedCodePoints.add(marked.codePoint)
	}

	return {
		report: mergeScanReports(findings),
		sources: findings.length,
		revealedCharacters: markElements.length,
		revealedCodePoints: [...revealedCodePoints].sort((left, right) => left - right),
		focus: readFocus(markElements.length),
	}
}

/** Changes the page */

/**
 * One text node a reveal replaced, kept so Hide can put the document back.
 *
 * Restoring the run re-inserts the very same `Text` node and removes the nodes
 * that replaced it, so the page returns to the shape it had before Show: same
 * node identity, same node count, same text. A run can only be restored while
 * its nodes are still where the reveal left them and the reader is hiding the
 * whole run; otherwise the marks go back one by one, which keeps the text right
 * but leaves the node split.
 */
interface RevealRun {
	/** The node whose children the run replaced. */
	readonly parent: Node
	/** The text node that was split, detached until the run is restored. */
	readonly original: Text
	/** The nodes that took its place, in document order. */
	readonly inserted: readonly ChildNode[]
	/** Set once the run's nodes were changed one by one; it can no longer restore as a whole. */
	degraded: boolean
}

/** Every run this document has revealed, oldest first. */
const revealRuns: RevealRun[] = []

/** One marker inside a run, with the character it kept. */
interface RunMark {
	readonly element: HTMLElement
	readonly value: string
	readonly codePoint: number
}

/**
 * Replace the chosen hidden characters in one text node with markers that spell
 * out their code points, for example `U+200B`, and record how to undo it.
 *
 * Replacing instead of inserting keeps the page text intact, and the record is
 * what lets Hide put the very same node back instead of a copy of its text.
 */
function revealTextNode(node: Text, selection: ReadonlySet<number>): number {
	const parent = node.parentNode
	if (parent === null) return 0

	const segments = splitTextByMarkedCharacters(node.nodeValue ?? '', (codePoint) => selection.has(codePoint))
	const hidden = countHiddenCharacters(segments)
	if (hidden === 0) return 0

	const fragment = createMarkedFragment(segments)
	// `replaceWith` moves the fragment's children into the page and leaves the
	// fragment empty, so the run has to remember them before that happens.
	const inserted = [...fragment.childNodes]

	node.replaceWith(fragment)
	revealRuns.push({ parent, original: node, inserted, degraded: false })

	return hidden
}

/** Reveal the chosen hidden characters throughout the page. */
function revealCodePoints(selection: ReadonlySet<number>): ChangeResult {
	let revealed = 0

	for (const node of collectTextNodes()) revealed += revealTextNode(node, selection)

	return { changed: revealed }
}

/** Every code point that still has an occurrence in the page's text. */
function codePointsInText(): Set<number> {
	const codePoints = new Set<number>()

	for (const node of collectTextNodes()) {
		for (const entry of scanText(node.nodeValue ?? '').byCodePoint) codePoints.add(entry.codePoint)
	}

	return codePoints
}

/** The code points currently drawn as markers, which is what "hide everything" acts on. */
function markedCodePoints(): Set<number> {
	const codePoints = new Set<number>()

	for (const mark of collectMarkElements()) {
		const marked = readMarkedCharacter(mark)
		if (marked !== null) codePoints.add(marked.codePoint)
	}

	return codePoints
}

/**
 * The markers a run still has in the page, in document order.
 *
 * `inserted` keeps the nodes the reveal put there even after they are replaced, so
 * a marker that was already restored — or that the page threw away — is still in
 * the record. Counting it again would report more characters than the reader has.
 */
function marksOf(run: RevealRun): RunMark[] {
	const marks: RunMark[] = []

	for (const node of run.inserted) {
		if (!(node instanceof HTMLElement) || !isMarkElement(node) || !node.isConnected) continue

		const marked = readMarkedCharacter(node)
		if (marked !== null) marks.push({ element: node, value: marked.value, codePoint: marked.codePoint })
	}

	return marks
}

/** Whether the run's nodes are still exactly where the reveal put them. */
function isRunIntact(run: RevealRun): boolean {
	if (run.degraded || !run.parent.isConnected) return false

	const first = run.inserted[0]
	if (first === undefined) return false

	const children = [...run.parent.childNodes]
	const start = children.indexOf(first)
	if (start < 0) return false

	return run.inserted.every((node, offset) => children[start + offset] === node)
}

/** Put a run's original text node back where it was and drop the nodes that replaced it. */
function restoreRun(run: RevealRun): void {
	const first = run.inserted[0]
	if (first === undefined) return

	run.parent.insertBefore(run.original, first)
	for (const node of run.inserted) node.remove()
}

/**
 * Put the chosen markers back, leaving every other finding revealed.
 *
 * Runs are handled newest first: a later reveal may have split a text node that
 * an earlier run had inserted, so restoring the newer run puts that node back
 * where the older run's record expects it.
 */
function hideCodePoints(selection: ReadonlySet<number>): ChangeResult {
	let hidden = 0

	for (let index = revealRuns.length - 1; index >= 0; index -= 1) {
		const run = revealRuns[index]
		if (run === undefined) continue

		const marks = marksOf(run)
		const selected = marks.filter((mark) => selection.has(mark.codePoint))
		if (selected.length === 0) continue

		if (selected.length === marks.length && isRunIntact(run)) {
			restoreRun(run)
			// The run is spent: its markers are gone, so keeping it would let a later
			// Hide count the same characters a second time.
			revealRuns.splice(index, 1)
			hidden += selected.length
			continue
		}

		if (isRunIntact(run)) {
			// Only part of the run goes back. Restore it whole, so the text node — and
			// not a copy of it — is what the page gets, then mark what stays revealed
			// again. The alternative, rewriting the surviving markers one by one,
			// would leave the node split forever.
			const kept = new Set(marks.filter((mark) => !selection.has(mark.codePoint)).map((mark) => mark.codePoint))

			restoreRun(run)
			revealRuns.splice(index, 1)
			hidden += selected.length
			revealTextNode(run.original, kept)
			continue
		}

		// The page moved the run, or rebuilt part of it already, so all that is left
		// is putting the chosen markers back one at a time.
		for (const mark of selected) {
			mark.element.replaceWith(mark.value)
			hidden += 1
		}

		run.degraded = true
	}

	// A marker can outlive its run: the page may move it, or the run may already
	// have been rebuilt marker by marker. Put those back too, so "hide this code
	// point" holds for every occurrence the reader can see.
	const tracked = new Set<HTMLElement>()
	for (const run of revealRuns) {
		for (const mark of marksOf(run)) tracked.add(mark.element)
	}

	for (const mark of collectMarkElements()) {
		if (tracked.has(mark)) continue

		const marked = readMarkedCharacter(mark)
		if (marked === null || !selection.has(marked.codePoint)) continue

		mark.replaceWith(marked.value)
		hidden += 1
	}

	pruneRevealRuns()

	if (hidden > 0) focusedIndex = -1
	return { changed: hidden }
}

/**
 * Forget the runs that have nothing left to restore.
 *
 * A degraded run stays in the list while it still has markers in the page: it is
 * the only record that those elements came from a text node, and dropping it
 * early would leave them invisible to a later Hide. A run whose markers the page
 * threw away is dropped here instead.
 */
function pruneRevealRuns(): void {
	for (let index = revealRuns.length - 1; index >= 0; index -= 1) {
		const run = revealRuns[index]
		if (run === undefined) continue

		if (!run.parent.isConnected || marksOf(run).length === 0) revealRuns.splice(index, 1)
	}
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

	// The registry describes markers that no longer exist, and restoring one of
	// its runs later would resurrect characters the reader just deleted.
	revealRuns.length = 0
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

	if (step === 0) {
		// Show means show everything, and then take the reader to the first of
		// them: a long page can push every marker below the fold.
		changed = revealCodePoints(codePointsInText()).changed
	} else if (collectMarkElements().length === 0) {
		// Stepping is not "show everything": a reader who turned one kind of
		// character off keeps that choice while they walk the rest. Only a page
		// with nothing revealed gets the full reveal, as it always did.
		changed = revealCodePoints(codePointsInText()).changed
	}

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

const requestHandlers: Record<CommandType, (request: CommandRequest) => CommandResponse> = {
	[messageType.scan]: scanRequest,
	[messageType.reveal]: () => changeRequest(() => revealCodePoints(codePointsInText())),
	[messageType.hide]: () => changeRequest(() => hideCodePoints(markedCodePoints())),
	[messageType.revealCodePoint]: (request) => changeRequest(() => revealCodePoints(selectionOf(request))),
	[messageType.hideCodePoint]: (request) => changeRequest(() => hideCodePoints(selectionOf(request))),
	[messageType.remove]: () => changeRequest(removeHiddenCharacters),
	[messageType.focusFirst]: () => focusRequest(0),
	[messageType.focusNext]: () => focusRequest(1),
	[messageType.focusPrevious]: () => focusRequest(-1),
}

/** The single code point a per-character command names. */
function selectionOf(request: CommandRequest): Set<number> {
	const { codePoint } = request
	if (codePoint === undefined) throw new Error('A per-character command needs a code point.')
	return new Set([codePoint])
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

		const response = runHandler(() => requestHandlers[request.type](request))
		sendResponse(response)
		publishScanForBadge(response)

		// The response is sent synchronously, so the channel does not stay open.
		return false
	})
}
