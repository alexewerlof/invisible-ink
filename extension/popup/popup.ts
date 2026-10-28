/**
 * The popup: asks the page detector what it found, renders the grouped report,
 * and forwards the reader's choices to the page.
 *
 * The popup owns no state that outlives it — every command answers with a fresh
 * scan, so the panel always shows what is on the page right now. A per-character
 * toggle is just a command like any other: it names one code point, the page
 * reveals or restores its occurrences, and the fresh scan tells the panel which
 * toggles are now on.
 */

import { ConfirmAction } from '../shared/confirm-action'
import { requireButton, requireElement } from '../shared/dom'
import { inspectPageUrl } from '../shared/inspect-page'
import {
	messageType,
	type CommandRequest,
	type CommandResponse,
	type CommandType,
	type FocusState,
} from '../shared/message-contract'
import {
	countLabel,
	describeFocus,
	focusLabel,
	groupReport,
	plural,
	renderLegend,
	renderReportGroups,
} from '../shared/report-view'
import { getActiveTab, isRestrictedPageUrl, requestInTab, UninspectablePageError } from '../shared/tab-messaging'

const countElement = requireElement('count')
const countLabelElement = requireElement('count-label')
const subtitleElement = requireElement('subtitle')
const groupsElement = requireElement('groups')
const revealButton = requireButton('reveal')
const removeButton = requireButton('remove')
const previousButton = requireButton('previous')
const nextButton = requireButton('next')
const refreshButton = requireButton('refresh')
const openInspectorButton = requireButton('open-inspector')
const focusElement = requireElement('focus-position')
const statusElement = requireElement('status')
const legendElement = requireElement('legend')

const unsupportedPageMessage =
	'This page cannot be inspected. Browser pages, the extension gallery and file viewers block extensions.'

/**
 * What a manual refresh reports. It is not a change the popup made, so it says
 * what happened rather than reusing the "what changed" wording.
 */
const refreshedStatus = 'Checked the page again.'

let activeTabId: number | null = null
let total = 0
let shownCharacters = 0
let shownCodePoints: ReadonlySet<number> = new Set()
/** Whether the page answered a scan, and so can be asked to scan again. */
let pageIsInspectable = false

/**
 * Remove edits the page rather than the view, so it asks first. The confirmation
 * closes again on any scan, which means a reader who toggles something else is
 * never left looking at a stale "remove everything?" question.
 */
const removeAction = new ConfirmAction({
	trigger: removeButton,
	panel: requireElement('remove-confirm'),
	confirmButton: requireButton('remove-confirm-yes'),
	cancelButton: requireButton('remove-confirm-no'),
	onConfirm: () => {
		void runCommand(messageType.remove)
	},
})

revealButton.addEventListener('click', () => {
	// Show reveals everything and takes the reader to the first finding; Hide puts
	// the page back exactly as it was.
	void runCommand(isFullyShown() ? messageType.hide : messageType.focusFirst)
})

// The page can change under the popup — a chat response streams in, a route
// swaps the document — so the reader can ask for a fresh count as often as they
// like. A scan is read-only, and the detector still publishes it to the badge.
refreshButton.addEventListener('click', () => {
	void runCommand(messageType.scan, refreshedStatus)
})

previousButton.addEventListener('click', () => {
	void runCommand(messageType.focusPrevious)
})

nextButton.addEventListener('click', () => {
	void runCommand(messageType.focusNext)
})

// The same panel works on text the reader pastes, which the detector cannot reach
// because a textarea keeps its text in the field rather than on the page.
openInspectorButton.addEventListener('click', () => {
	void openInspector()
})

renderLegend(legendElement)

// A module script runs after the document is parsed, and the popup gets a fresh
// module instance every time it opens, so this is where the popup re-reads the
// page instead of remembering anything from last time.
void openPopup()

async function openPopup(): Promise<void> {
	const tab = await getActiveTab()
	if (tab?.id === undefined) {
		showFailure('There is no active tab to inspect.')
		return
	}

	activeTabId = tab.id

	// A browser page can never answer, so ask it nothing: the injection retry
	// would only reject with the same "cannot access" error we can see here.
	if (isRestrictedPageUrl(tab.url)) {
		showFailure(unsupportedPageMessage)
		return
	}

	await runCommand(messageType.scan)
}

/** Open the paste-in inspector in its own tab, and get out of its way. */
async function openInspector(): Promise<void> {
	await chrome.tabs.create({ url: inspectPageUrl() })
	window.close()
}

/** Whether every finding is currently on the page as a marker. */
function isFullyShown(): boolean {
	return total > 0 && shownCharacters >= total
}

/** Turn one code point on or off, and let the fresh scan redraw the toggles. */
function toggleCodePoint(codePoint: number): void {
	const type = shownCodePoints.has(codePoint) ? messageType.hideCodePoint : messageType.revealCodePoint
	void runCommand(type, '', codePoint)
}

async function runCommand(type: CommandType, announcement = '', codePoint?: number): Promise<void> {
	if (activeTabId === null) return

	updateButtons(true)

	const request: CommandRequest = codePoint === undefined ? { type } : { type, codePoint }

	try {
		const response = await requestInTab(activeTabId, request)

		if (!response.ok) {
			showFailure(response.reason)
			return
		}

		renderScan(response, type, announcement)
	} catch (error) {
		// A page that refuses the content script has already been answered: the
		// panel says below that it cannot be inspected. Logging it would put a
		// warning in the console for something ordinary, such as opening the popup
		// on a browser page, where Chrome never exposes `tab.url` to ask first.
		if (!(error instanceof UninspectablePageError)) {
			console.warn('[Invisible Ink] the page did not answer', error)
		}
		showFailure(unsupportedPageMessage)
	} finally {
		updateButtons(false)
	}
}

function renderScan(response: Extract<CommandResponse, { ok: true }>, type: CommandType, announcement: string): void {
	const { report, sources, revealedCharacters, revealedCodePoints, focus } = response.scan

	total = report.total
	shownCharacters = revealedCharacters
	shownCodePoints = new Set(revealedCodePoints)
	pageIsInspectable = true

	countElement.textContent = String(report.total)
	countLabelElement.textContent = countLabel(report.total)
	subtitleElement.textContent = describeFindings(report.total, sources)
	statusElement.textContent = announcement === '' ? describeChange(type, response.changed, focus) : announcement
	focusElement.textContent = focusLabel(focus)

	removeAction.close()

	renderReportGroups(groupsElement, groupReport(report), {
		isRevealed: (codePoint) => shownCodePoints.has(codePoint),
		onToggle: (codePoint) => {
			toggleCodePoint(codePoint)
		},
	})
}

function describeFindings(found: number, sources: number): string {
	if (found === 0) return 'Nothing hidden on this page.'
	return `Found in ${plural(sources, 'element')} on the page.`
}

function describeChange(type: CommandType, changed: number, focus: FocusState | null): string {
	// The popup's Show reveals every finding; the right-click menu's plain
	// `reveal` does the same, and both report how many characters appeared.
	if (type === messageType.reveal || type === messageType.revealCodePoint || type === messageType.focusFirst) {
		return changed > 0 ? `Revealed ${plural(changed, 'hidden character')}.` : describeFocus(focus)
	}

	if (type === messageType.hide || type === messageType.hideCodePoint) {
		return changed > 0 ? `Restored ${plural(changed, 'character')}.` : ''
	}

	if (type === messageType.remove) return `Removed ${plural(changed, 'character')}.`
	return describeFocus(focus)
}

/**
 * Show why nothing can be inspected, and leave the panel in a state where the
 * buttons cannot promise anything.
 */
function showFailure(message: string): void {
	total = 0
	shownCharacters = 0
	shownCodePoints = new Set()
	pageIsInspectable = false

	countElement.textContent = '0'
	countLabelElement.textContent = 'characters found'
	subtitleElement.textContent = ''
	statusElement.textContent = message
	groupsElement.replaceChildren()
	focusElement.textContent = ''

	removeAction.close()
	updateButtons(false)
}

function updateButtons(busy: boolean): void {
	const usable = total > 0

	// A refresh is worth offering whenever the page can answer, even at zero:
	// that is exactly the moment new content may have brought findings with it.
	refreshButton.disabled = busy || !pageIsInspectable
	refreshButton.classList.toggle('ii-panel__refresh--busy', busy)

	revealButton.textContent = isFullyShown() ? 'Hide all' : 'Show all'
	revealButton.disabled = busy || !usable
	removeButton.disabled = busy || !usable
	previousButton.disabled = busy || !usable
	nextButton.disabled = busy || !usable

	if (!usable) removeAction.close()
}
