/**
 * The messaging contract between the popup, the service worker and the page
 * detector. Holding the type strings here means a rename is a single edit.
 *
 * Values that arrive on a `chrome.runtime` message channel are typed `any` by
 * `@types/chrome`, so this module also owns the runtime checks that turn an
 * untrusted message into one of the types below. That is what keeps the callers
 * honest without reaching for a type assertion.
 */

import { CHARACTER_RULES, severity, type RuleId, type Severity } from './hidden-character-rules'
import type { CodePointCount, RuleCount, HiddenCharacterReport } from './hidden-character-scan'

const namespace = 'invisible-ink'

export const messageType = {
	/** popup or service worker to page detector: measure the page. */
	scan: `${namespace}:scan`,
	/**
	 * Replace every hidden character with a visible marker. This is the
	 * right-click menu's action; the popup's Show goes through `focusFirst` so it
	 * can also scroll the reader to the first finding.
	 */
	reveal: `${namespace}:reveal`,
	/** Put the markers back to the characters they replaced. */
	hide: `${namespace}:hide`,
	/** Delete every hidden character and marker. */
	remove: `${namespace}:remove`,
	/** Reveal the page if it is still hidden, then jump to the first finding. */
	focusFirst: `${namespace}:focus-first`,
	/** Jump to the next finding, revealing the page first if it is hidden. */
	focusNext: `${namespace}:focus-next`,
	/** Jump to the previous finding, revealing the page first if it is hidden. */
	focusPrevious: `${namespace}:focus-previous`,
	/** page detector to service worker: refresh the toolbar badge. */
	report: `${namespace}:report`,
} as const

/** Every message this extension sends, in either direction. */
export type MessageType = (typeof messageType)[keyof typeof messageType]

/** The messages a page detector answers: everything except the badge report. */
export type CommandType = Exclude<MessageType, typeof messageType.report>

/** A command sent to a page detector. */
export interface CommandRequest {
	readonly type: CommandType
}

/**
 * Where the reader is looking, once the page has been revealed.
 *
 * The detector keeps this because the popup is rebuilt every time it opens, so
 * the page is the only thing that remembers which occurrence was highlighted.
 */
export interface FocusState {
	/** Zero-based position of the highlighted finding in document order. */
	readonly index: number
	/** How many findings the page has, so the popup can show "3 / 21". */
	readonly total: number
}

/** What the page detector answers a command with. */
export interface ScanResult {
	readonly report: HiddenCharacterReport
	/** How many text nodes or markers held findings. */
	readonly sources: number
	/** How many findings are currently visible as markers. */
	readonly revealedCharacters: number
	/** The highlighted finding, or `null` while nothing is highlighted. */
	readonly focus: FocusState | null
}

/**
 * The answer to a command.
 *
 * `changed` is the number of characters the command touched, so the popup can
 * report "removed 128 characters" without comparing two scans.
 */
export type CommandResponse =
	| { readonly ok: true; readonly changed: number; readonly scan: ScanResult }
	| { readonly ok: false; readonly reason: string }

/** The count the detector publishes so the service worker can refresh the badge. */
export interface ReportMessage {
	readonly type: typeof messageType.report
	readonly payload: {
		readonly total: number
		readonly revealedCharacters: number
	}
}

const knownRuleIds = new Set<string>(CHARACTER_RULES.map((rule) => rule.id))
const knownSeverities = new Set<string>(Object.values(severity))
const knownCommands = new Set<string>([
	messageType.scan,
	messageType.reveal,
	messageType.hide,
	messageType.remove,
	messageType.focusFirst,
	messageType.focusNext,
	messageType.focusPrevious,
])

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === 'object' && value !== null
}

function isString(value: unknown): value is string {
	return typeof value === 'string'
}

function isCount(value: unknown): value is number {
	return typeof value === 'number' && Number.isInteger(value) && value >= 0
}

function isRuleId(value: unknown): value is RuleId {
	return isString(value) && knownRuleIds.has(value)
}

function isSeverity(value: unknown): value is Severity {
	return isString(value) && knownSeverities.has(value)
}

function isRuleCount(value: unknown): value is RuleCount {
	if (!isRecord(value)) return false

	return (
		isRuleId(value.id) &&
		isString(value.label) &&
		isSeverity(value.severity) &&
		isString(value.note) &&
		isCount(value.count)
	)
}

function isCodePointCount(value: unknown): value is CodePointCount {
	if (!isRecord(value)) return false

	return isCount(value.codePoint) && isString(value.formatted) && isCount(value.count)
}

function isHiddenCharacterReport(value: unknown): value is HiddenCharacterReport {
	if (!isRecord(value)) return false

	const { total, byRule, byCodePoint } = value

	return (
		isCount(total) &&
		Array.isArray(byRule) &&
		byRule.every(isRuleCount) &&
		Array.isArray(byCodePoint) &&
		byCodePoint.every(isCodePointCount)
	)
}

function isFocusState(value: unknown): value is FocusState {
	if (!isRecord(value)) return false

	const { index, total } = value

	return isCount(index) && isCount(total)
}

function isScanResult(value: unknown): value is ScanResult {
	if (!isRecord(value)) return false

	const { report, sources, revealedCharacters, focus } = value

	return (
		isHiddenCharacterReport(report) &&
		isCount(sources) &&
		isCount(revealedCharacters) &&
		(focus === null || isFocusState(focus))
	)
}

/** Narrow a message to a command this extension sent to a page detector. */
export function isCommandRequest(value: unknown): value is CommandRequest {
	if (!isRecord(value)) return false

	const { type } = value

	return isString(type) && knownCommands.has(type)
}

/** Narrow a detector's answer, which crosses the message channel as `any`. */
export function isCommandResponse(value: unknown): value is CommandResponse {
	if (!isRecord(value)) return false

	if (value.ok === false) return isString(value.reason)
	if (value.ok !== true) return false

	return isCount(value.changed) && isScanResult(value.scan)
}

/** Narrow a message to the badge report the page detector publishes. */
export function isReportMessage(value: unknown): value is ReportMessage {
	if (!isRecord(value) || value.type !== messageType.report) return false

	const { payload } = value
	if (!isRecord(payload)) return false

	return isCount(payload.total) && isCount(payload.revealedCharacters)
}
