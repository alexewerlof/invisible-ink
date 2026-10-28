/**
 * The paste-in inspector: an extension page with the text the reader pastes on
 * the left and the same text with every hidden character marked beside it.
 *
 * There is no page to ask and no messaging to the detector: the text lives in the
 * textarea, so the shared `LocalInspection` session scans and edits it directly,
 * and the panel is drawn by the same helpers the popup uses. Only the middle
 * column is new, and it is built from the same marker the content script inserts.
 */

import { ConfirmAction } from '../shared/confirm-action'
import { prefersReducedMotion, requireButton, requireElement, requireTextArea } from '../shared/dom'
import { activeMarkClass, collectMarkElements, createMarkedFragment } from '../shared/hidden-character-mark'
import { LocalInspection } from '../shared/inspect-session'
import {
	isPendingTextResponse,
	messageType,
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
import { splitTextByMarkedCharacters, stripHiddenCharacters } from '../shared/hidden-character-scan'

const session = new LocalInspection()

const inputElement = requireTextArea('input')
const markedElement = requireElement('marked')
const countElement = requireElement('count')
const countLabelElement = requireElement('count-label')
const subtitleElement = requireElement('subtitle')
const groupsElement = requireElement('groups')
const revealButton = requireButton('reveal')
const removeButton = requireButton('remove')
const previousButton = requireButton('previous')
const nextButton = requireButton('next')
const copyButton = requireButton('copy')
const focusElement = requireElement('focus-position')
const statusElement = requireElement('status')
const legendElement = requireElement('legend')

/** The pause between a keystroke and a scan, so a fast typist is not rescanned per key. */
const renderDelayMs = 150

let total = 0
let shownCharacters = 0
let shownCodePoints: ReadonlySet<number> = new Set()
let renderTimer: ReturnType<typeof setTimeout> | null = null

/** Remove edits the text for good, so it asks first, exactly as the popup does. */
const removeAction = new ConfirmAction({
	trigger: removeButton,
	panel: requireElement('remove-confirm'),
	confirmButton: requireButton('remove-confirm-yes'),
	cancelButton: requireButton('remove-confirm-no'),
	onConfirm: () => {
		runCommand(messageType.remove)
	},
})

revealButton.addEventListener('click', () => {
	runCommand(isFullyShown() ? messageType.hide : messageType.reveal)
})

previousButton.addEventListener('click', () => {
	runCommand(messageType.focusPrevious)
})

nextButton.addEventListener('click', () => {
	runCommand(messageType.focusNext)
})

copyButton.addEventListener('click', () => {
	void copyCleanedText()
})

inputElement.addEventListener('input', () => {
	if (renderTimer !== null) clearTimeout(renderTimer)
	renderTimer = setTimeout(() => {
		renderTimer = null
		session.setText(inputElement.value)
		runCommand(messageType.scan)
	}, renderDelayMs)
})

renderLegend(legendElement)
void openPage()

/** Load the selection a menu click handed over, then take the first look. */
async function openPage(): Promise<void> {
	const pending = await takePendingText()
	if (pending !== null) {
		inputElement.value = pending
		session.setText(pending)
	}

	runCommand(messageType.scan)
	inputElement.focus()
}

/**
 * Ask the service worker for the text a right-click handed over.
 *
 * The text never goes in the URL: the worker holds the selection while the page
 * loads and gives it up once. Nothing waiting means the page was opened another
 * way, which is not an error.
 */
async function takePendingText(): Promise<string | null> {
	try {
		const answer: unknown = await chrome.runtime.sendMessage({ type: messageType.takePendingText })
		if (isPendingTextResponse(answer)) return answer.text
	} catch (error) {
		console.warn('[Invisible Ink] could not ask for a pending selection', error)
	}

	return null
}

function runCommand(type: CommandType, codePoint?: number): void {
	const response = session.run(type, codePoint)
	if (!response.ok) return

	// Remove is the one command that changes the text rather than the view, so the
	// field has to follow it. The middle column reads the field, so syncing here is
	// what keeps the two panes showing the same text.
	if (inputElement.value !== session.value) inputElement.value = session.value

	renderScan(response, type)
}

/** Whether every finding in the text is currently marked. */
function isFullyShown(): boolean {
	return total > 0 && shownCharacters >= total
}

/** Turn one code point on or off, and let the fresh scan redraw the toggles. */
function toggleCodePoint(codePoint: number): void {
	const type = shownCodePoints.has(codePoint) ? messageType.hideCodePoint : messageType.revealCodePoint
	runCommand(type, codePoint)
}

function renderScan(response: Extract<CommandResponse, { ok: true }>, type: CommandType): void {
	const { report, sources, revealedCharacters, revealedCodePoints, focus } = response.scan

	total = report.total
	shownCharacters = revealedCharacters
	shownCodePoints = new Set(revealedCodePoints)

	countElement.textContent = String(report.total)
	countLabelElement.textContent = countLabel(report.total)
	subtitleElement.textContent = describeFindings(report.total, sources)
	statusElement.textContent = describeChange(type, response.changed) || describeFocus(focus)
	focusElement.textContent = focusLabel(focus)

	removeAction.close()

	renderReportGroups(groupsElement, groupReport(report), {
		isRevealed: (codePoint) => shownCodePoints.has(codePoint),
		onToggle: (codePoint) => {
			toggleCodePoint(codePoint)
		},
	})

	renderMarkedColumn()
	highlightFocusedMark(session.isRevealed ? focus : null)
	updateButtons()
}

function describeFindings(found: number, lines: number): string {
	if (found === 0) return 'Nothing hidden in this text.'
	return `Found on ${plural(lines, 'line')}.`
}

function describeChange(type: CommandType, changed: number): string {
	if (type === messageType.remove) return `Removed ${plural(changed, 'character')}.`
	if (type === messageType.reveal) return 'Marked every hidden character.'
	if (type === messageType.hide) return 'Showing the text unmarked.'
	if (type === messageType.revealCodePoint) return `Marked ${plural(changed, 'character')}.`
	if (type === messageType.hideCodePoint) return `Unmarked ${plural(changed, 'character')}.`
	return ''
}

/** Draw the middle column: the text with a marker per hidden character, or the text as it is. */
function renderMarkedColumn(): void {
	markedElement.replaceChildren()

	if (inputElement.value === '') {
		markedElement.classList.add('ii-inspect__marked--empty')
		markedElement.textContent = 'Nothing to inspect yet. Paste or type some text on the left.'
		return
	}

	markedElement.classList.remove('ii-inspect__marked--empty')

	if (session.isRevealed) {
		markedElement.append(
			createMarkedFragment(
				splitTextByMarkedCharacters(inputElement.value, (codePoint) => shownCodePoints.has(codePoint)),
			),
		)
	} else {
		markedElement.textContent = inputElement.value
	}
}

/** Ring the highlighted marker and bring it into view, the way the popup's Show does. */
function highlightFocusedMark(focus: FocusState | null): void {
	const marks = collectMarkElements(markedElement)

	for (const [index, mark] of marks.entries()) {
		mark.classList.toggle(activeMarkClass, focus !== null && index === focus.index)
	}

	if (focus !== null) {
		marks[focus.index]?.scrollIntoView({
			block: 'center',
			inline: 'center',
			behavior: prefersReducedMotion() ? 'auto' : 'smooth',
		})
	}
}

async function copyCleanedText(): Promise<void> {
	const cleaned = stripHiddenCharacters(inputElement.value)

	try {
		await navigator.clipboard.writeText(cleaned)
		statusElement.textContent = 'Copied the cleaned text to the clipboard.'
	} catch (error) {
		statusElement.textContent = 'Could not write to the clipboard.'
		console.warn('[Invisible Ink] could not copy the cleaned text', error)
	}
}

function updateButtons(): void {
	const usable = total > 0

	revealButton.textContent = isFullyShown() ? 'Hide all' : 'Show all'
	revealButton.disabled = !usable
	removeButton.disabled = !usable
	previousButton.disabled = !usable
	nextButton.disabled = !usable
	copyButton.disabled = inputElement.value === ''

	if (!usable) removeAction.close()
}
