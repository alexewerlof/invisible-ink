/**
 * The messaging contract between the popup, the service worker and the page
 * detector. Holding the type strings here means a rename is a single edit.
 *
 * Values that arrive on a `chrome.runtime` message channel are typed `any` by
 * `@types/chrome`, so this module also owns the runtime checks that turn an
 * untrusted message into one of the types below. That is what keeps the callers
 * honest without reaching for a type assertion.
 */

import { CHARACTER_RULES, isSeverity, type RuleId } from './hidden-character-rules'
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
	/** Reveal the occurrences of one code point, leaving every other finding as text. */
	revealCodePoint: `${namespace}:reveal-code-point`,
	/** Put one code point's markers back, leaving every other finding revealed. */
	hideCodePoint: `${namespace}:hide-code-point`,
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
	/** the paste-in inspector to service worker: hand over the selection a menu click saved. */
	takePendingText: `${namespace}:take-pending-text`,
} as const

/** Every message this extension sends, in either direction. */
export type MessageType = (typeof messageType)[keyof typeof messageType]

/**
 * The messages a page detector answers.
 *
 * Written out rather than derived with `Exclude`, because a new message that is
 * neither a page command nor the badge report would otherwise slip into
 * `CommandType` silently — and the detector's handler table is typed against it,
 * so a missing handler would look like valid code.
 */
export const commandTypes = [
	messageType.scan,
	messageType.reveal,
	messageType.hide,
	messageType.revealCodePoint,
	messageType.hideCodePoint,
	messageType.remove,
	messageType.focusFirst,
	messageType.focusNext,
	messageType.focusPrevious,
] as const satisfies readonly MessageType[]

/** One of the commands a page detector answers. */
export type CommandType = (typeof commandTypes)[number]

/**
 * The commands that act on a single code point, and so have to carry one.
 *
 * Listed separately so the guard can reject a request that names a code point
 * command but forgets the code point, instead of leaving every handler to check.
 */
export const codePointCommandTypes = [
	messageType.revealCodePoint,
	messageType.hideCodePoint,
] as const satisfies readonly CommandType[]

/** The subset of `CommandType` that needs a `codePoint` payload. */
export type CodePointCommandType = (typeof codePointCommandTypes)[number]

/** Whether a command acts on a single code point. */
export function requiresCodePoint(type: CommandType): type is CodePointCommandType {
	return (codePointCommandTypes as readonly string[]).includes(type)
}

/** A command sent to a page detector. */
export interface CommandRequest {
	readonly type: CommandType
	/** The code point a per-character command acts on. Required for those commands. */
	readonly codePoint?: number
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
	/** Which code points are currently visible as markers, ascending. */
	readonly revealedCodePoints: readonly number[]
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

/**
 * The paste-in inspector asking the service worker for the text a menu click
 * handed over.
 *
 * The text is deliberately not put in the page's URL: the worker holds the
 * selection while the tab loads and gives it up once, so a selection never ends
 * up in the address bar or in session history, and no `storage` permission is
 * needed.
 */
export interface PendingTextRequest {
	readonly type: typeof messageType.takePendingText
}

/** The answer: the held text, or `null` when nothing is waiting. */
export interface PendingTextResponse {
	readonly text: string | null
}

const knownRuleIds = new Set<string>(CHARACTER_RULES.map((rule) => rule.id))
const knownCommands = new Set<string>(commandTypes)

/** The highest code point Unicode defines, which is the widest a `codePoint` may be. */
const maxCodePoint = 0x10ffff

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

function isCommandType(value: unknown): value is CommandType {
	return isString(value) && knownCommands.has(value)
}

/** A Unicode code point, which is what a per-character command names. */
function isCodePoint(value: unknown): value is number {
	return isCount(value) && value <= maxCodePoint
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

	const { report, sources, revealedCharacters, revealedCodePoints, focus } = value

	return (
		isHiddenCharacterReport(report) &&
		isCount(sources) &&
		isCount(revealedCharacters) &&
		Array.isArray(revealedCodePoints) &&
		revealedCodePoints.every(isCodePoint) &&
		(focus === null || isFocusState(focus))
	)
}

/** Narrow a message to a command this extension sent to a page detector. */
export function isCommandRequest(value: unknown): value is CommandRequest {
	if (!isRecord(value)) return false

	const { type, codePoint } = value
	if (!isCommandType(type)) return false

	// A per-character command without a code point is a caller bug, and answering
	// it as if it were "reveal everything" would hide that bug from the reader.
	if (requiresCodePoint(type)) return isCodePoint(codePoint)

	return codePoint === undefined || isCodePoint(codePoint)
}

/** Narrow a detector's answer, which crosses the message channel as `any`. */
export function isCommandResponse(value: unknown): value is CommandResponse {
	if (!isRecord(value)) return false

	if (value.ok === false) return isString(value.reason)
	if (value.ok !== true) return false

	return isCount(value.changed) && isScanResult(value.scan)
}

/** Narrow a message to the inspector's request for the held selection. */
export function isPendingTextRequest(value: unknown): value is PendingTextRequest {
	return isRecord(value) && value.type === messageType.takePendingText
}

/** Narrow the worker's answer, which also crosses the channel as `any`. */
export function isPendingTextResponse(value: unknown): value is PendingTextResponse {
	if (!isRecord(value)) return false

	const { text } = value

	return text === null || isString(text)
}

/** Narrow a message to the badge report the page detector publishes. */
export function isReportMessage(value: unknown): value is ReportMessage {
	if (!isRecord(value) || value.type !== messageType.report) return false

	const { payload } = value
	if (!isRecord(payload)) return false

	return isCount(payload.total) && isCount(payload.revealedCharacters)
}
