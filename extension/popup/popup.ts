/**
 * The popup: asks the page detector what it found, renders the counter and the
 * breakdown, and forwards the Show and Remove buttons to the page.
 *
 * The popup owns no state that outlives it — every command answers with a fresh
 * scan, so the panel always shows what is on the page right now.
 */

import { requireButton, requireElement } from '../shared/dom'
import { inspectPageUrl } from '../shared/inspect-page'
import { messageType, type CommandResponse, type CommandType, type FocusState } from '../shared/message-contract'
import {
	countLabel,
	describeFocus,
	focusLabel,
	plural,
	renderCharacters,
	renderKinds,
	renderLegend,
} from '../shared/report-view'
import { getActiveTab, isRestrictedPageUrl, requestInTab, UninspectablePageError } from '../shared/tab-messaging'

const countElement = requireElement('count')
const countLabelElement = requireElement('count-label')
const subtitleElement = requireElement('subtitle')
const kindsElement = requireElement('kinds')
const charactersElement = requireElement('characters')
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
let revealed = false
/** Whether the page answered a scan, and so can be asked to scan again. */
let pageIsInspectable = false

revealButton.addEventListener('click', () => {
	void runCommand(revealed ? messageType.hide : messageType.focusFirst)
})

removeButton.addEventListener('click', () => {
	void runCommand(messageType.remove)
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

async function runCommand(type: CommandType, announcement = ''): Promise<void> {
	if (activeTabId === null) return

	updateButtons(true)

	try {
		const response = await requestInTab(activeTabId, type)

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
	const { report, sources, revealedCharacters, focus } = response.scan

	total = report.total
	revealed = revealedCharacters > 0
	pageIsInspectable = true

	countElement.textContent = String(report.total)
	countLabelElement.textContent = countLabel(report.total)
	subtitleElement.textContent = describeFindings(report.total, sources)
	statusElement.textContent = announcement === '' ? describeChange(type, response.changed, focus) : announcement

	focusElement.textContent = focusLabel(focus)
	renderKinds(kindsElement, report.byRule)
	renderCharacters(charactersElement, report.byCodePoint)
}

function describeFindings(found: number, sources: number): string {
	if (found === 0) return 'Nothing hidden on this page.'
	return `Found in ${plural(sources, 'element')} on the page.`
}

function describeChange(type: CommandType, changed: number, focus: FocusState | null): string {
	// The popup's Show is `focusFirst`, so it reports the reveal as much as the
	// jump; the right-click menu's plain `reveal` reports the same thing.
	if (type === messageType.reveal || (type === messageType.focusFirst && changed > 0)) {
		return `Revealed ${plural(changed, 'hidden character')}.`
	}
	if (type === messageType.hide) return `Restored ${plural(changed, 'character')}.`
	if (type === messageType.remove) return `Removed ${plural(changed, 'character')}.`
	return describeFocus(focus)
}

/**
 * Show why nothing can be inspected, and leave the panel in a state where the
 * buttons cannot promise anything.
 */
function showFailure(message: string): void {
	total = 0
	revealed = false
	pageIsInspectable = false

	countElement.textContent = '0'
	countLabelElement.textContent = 'characters found'
	subtitleElement.textContent = ''
	statusElement.textContent = message
	kindsElement.replaceChildren()
	charactersElement.replaceChildren()
	focusElement.textContent = ''

	updateButtons(false)
}

function updateButtons(busy: boolean): void {
	const usable = total > 0

	// A refresh is worth offering whenever the page can answer, even at zero:
	// that is exactly the moment new content may have brought findings with it.
	refreshButton.disabled = busy || !pageIsInspectable
	refreshButton.classList.toggle('ii-panel__refresh--busy', busy)

	revealButton.textContent = revealed ? 'Hide' : 'Show'
	revealButton.disabled = busy || !usable
	removeButton.disabled = busy || !usable
	previousButton.disabled = busy || !usable
	nextButton.disabled = busy || !usable
}
