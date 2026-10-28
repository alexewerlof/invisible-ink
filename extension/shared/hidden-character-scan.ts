/**
 * Pure text helpers for finding, counting and stripping hidden characters.
 *
 * Nothing here touches the DOM or the Chrome APIs, so the whole module can be
 * exercised from Node (see test/hidden-character-scan.test.ts). The page detector,
 * the popup and the tests all share these functions, which keeps one definition
 * of "what counts as hidden".
 */

import {
	CHARACTER_RULES,
	formatCodePoint,
	isSpaceSubstitute,
	ruleForCodePoint,
	type CharacterRule,
	type RuleId,
	type Severity,
} from './hidden-character-rules'

/** The two kinds of piece `splitTextByHiddenCharacters` produces. */
export const segmentKind = {
	text: 'text',
	hiddenCharacter: 'hidden-character',
} as const

/** One run of ordinary text between two findings. */
export interface TextSegment {
	readonly kind: typeof segmentKind.text
	readonly value: string
}

/** A single hidden character, with the rule that matched it. */
export interface HiddenCharacterSegment {
	readonly kind: typeof segmentKind.hiddenCharacter
	readonly value: string
	readonly codePoint: number
	readonly rule: CharacterRule
}

/** One piece of a split string. */
export type Segment = TextSegment | HiddenCharacterSegment

/** One rule's share of a report. */
export interface RuleCount {
	readonly id: RuleId
	readonly label: string
	readonly severity: Severity
	readonly note: string
	readonly count: number
}

/** One code point's share of a report. */
export interface CodePointCount {
	readonly codePoint: number
	/** The same code point in `U+200B` form, ready to render. */
	readonly formatted: string
	readonly count: number
}

/**
 * What a scan found.
 *
 * Reports are plain objects, which is also the shape that crosses the messaging
 * boundary between the page and the popup.
 */
export interface HiddenCharacterReport {
	readonly total: number
	/** One entry per rule that matched, in the order of the rules table. */
	readonly byRule: readonly RuleCount[]
	/** One entry per distinct code point, most frequent first. */
	readonly byCodePoint: readonly CodePointCount[]
}

/** Count the hidden characters in a string. */
export function scanText(text: string): HiddenCharacterReport {
	const countsByRule = new Map<RuleId, number>()
	const countsByCodePoint = new Map<number, number>()
	let total = 0

	for (const character of text) {
		const codePoint = character.codePointAt(0)
		if (codePoint === undefined) continue

		const rule = ruleForCodePoint(codePoint)
		if (rule === null) continue

		total += 1
		countsByRule.set(rule.id, (countsByRule.get(rule.id) ?? 0) + 1)
		countsByCodePoint.set(codePoint, (countsByCodePoint.get(codePoint) ?? 0) + 1)
	}

	return createReport(total, countsByRule, countsByCodePoint)
}

/** Combine several reports into one, for example the per-element reports of a page. */
export function mergeScanReports(reports: readonly HiddenCharacterReport[]): HiddenCharacterReport {
	const countsByRule = new Map<RuleId, number>()
	const countsByCodePoint = new Map<number, number>()
	let total = 0

	for (const report of reports) {
		total += report.total

		for (const entry of report.byRule) {
			countsByRule.set(entry.id, (countsByRule.get(entry.id) ?? 0) + entry.count)
		}

		for (const entry of report.byCodePoint) {
			countsByCodePoint.set(entry.codePoint, (countsByCodePoint.get(entry.codePoint) ?? 0) + entry.count)
		}
	}

	return createReport(total, countsByRule, countsByCodePoint)
}

/**
 * Split a string into ordinary text and hidden characters, one segment per
 * character, so a caller can rebuild the text either way.
 *
 * Iterating the string yields whole code points, not UTF-16 units, which matters
 * for the tag block and variation selectors above U+FFFF.
 */
export function splitTextByHiddenCharacters(text: string): Segment[] {
	const segments: Segment[] = []
	let pendingText = ''

	for (const character of text) {
		// A string iterator yields whole code points, so `codePointAt(0)` is always
		// present; the check is what tells the compiler so.
		const codePoint = character.codePointAt(0)
		if (codePoint === undefined) {
			pendingText += character
			continue
		}

		const rule = ruleForCodePoint(codePoint)
		if (rule === null) {
			pendingText += character
			continue
		}

		if (pendingText !== '') {
			segments.push({ kind: segmentKind.text, value: pendingText })
			pendingText = ''
		}

		segments.push({ kind: segmentKind.hiddenCharacter, value: character, codePoint, rule })
	}

	if (pendingText !== '') {
		segments.push({ kind: segmentKind.text, value: pendingText })
	}

	return segments
}

/**
 * Split a string the way `splitTextByHiddenCharacters` does, but leave the
 * hidden characters the caller did not select inside the surrounding text.
 *
 * The reader reveals one code point at a time, so a text node has to be split
 * into the characters they switched on and everything else — including the
 * hidden characters they left switched off. Adjacent text is merged back into
 * one segment, so a filtered split never yields two text segments in a row.
 */
export function splitTextByMarkedCharacters(text: string, isSelected: (codePoint: number) => boolean): Segment[] {
	const segments: Segment[] = []

	for (const segment of splitTextByHiddenCharacters(text)) {
		if (segment.kind === segmentKind.hiddenCharacter && isSelected(segment.codePoint)) {
			segments.push(segment)
			continue
		}

		appendTextSegment(segments, segment.value)
	}

	return segments
}

/** Append ordinary text, folding it into the segment before it when that is text too. */
function appendTextSegment(segments: Segment[], value: string): void {
	const previous = segments.at(-1)

	if (previous?.kind === segmentKind.text) {
		segments[segments.length - 1] = { kind: segmentKind.text, value: previous.value + value }
		return
	}

	segments.push({ kind: segmentKind.text, value })
}

/** Count the hidden-character segments of a split string. */
export function countHiddenCharacters(segments: readonly Segment[]): number {
	let count = 0

	for (const segment of segments) {
		if (segment.kind === segmentKind.hiddenCharacter) count += 1
	}

	return count
}

/** Keep only the ordinary text of a split string. */
export function joinTextSegments(segments: readonly Segment[]): string {
	let text = ''

	for (const segment of segments) {
		if (segment.kind === segmentKind.text) text += segment.value
	}

	return text
}

/**
 * Rebuild a string from its segments, dropping the hidden characters but keeping
 * a normal space wherever one of them stood in for a space.
 *
 * A no-break space or a blank filler is a space the reader can see: deleting it
 * would run two words together, which is a worse outcome than leaving it in. So
 * a space substitute becomes an ordinary space and everything else is dropped.
 */
export function joinCleanSegments(segments: readonly Segment[]): string {
	let text = ''

	for (const segment of segments) {
		if (segment.kind === segmentKind.text) {
			text += segment.value
		} else if (isSpaceSubstitute(segment.rule)) {
			text += ' '
		}
	}

	return text
}

/**
 * Strip every hidden character from a string, putting an ordinary space back
 * where a space look-alike stood in for one.
 */
export function stripHiddenCharacters(text: string): string {
	return joinCleanSegments(splitTextByHiddenCharacters(text))
}

/**
 * Build the report shape that the popup renders.
 *
 * `byRule` follows the order of the rules table so the list does not jump around
 * between scans; `byCodePoint` puts the most frequent character first.
 */
function createReport(
	total: number,
	countsByRule: Map<RuleId, number>,
	countsByCodePoint: Map<number, number>,
): HiddenCharacterReport {
	const byRule = CHARACTER_RULES.filter((rule) => countsByRule.has(rule.id)).map((rule) => ({
		id: rule.id,
		label: rule.label,
		severity: rule.severity,
		note: rule.note,
		count: countsByRule.get(rule.id) ?? 0,
	}))

	const byCodePoint = [...countsByCodePoint.entries()]
		.map(([codePoint, count]) => ({ codePoint, formatted: formatCodePoint(codePoint), count }))
		.sort((left, right) => right.count - left.count || left.codePoint - right.codePoint)

	return { total, byRule, byCodePoint }
}
