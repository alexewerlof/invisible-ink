/**
 * The scanning rules are the part of the extension that is easy to get subtly
 * wrong (code points above U+FFFF, ranges that overlap, removals that lose
 * ordinary text), so they are covered here without needing a browser.
 */

import { describe, expect, it } from 'vitest'

import {
	countHiddenCharacters,
	joinTextSegments,
	mergeScanReports,
	scanText,
	segmentKind,
	splitTextByHiddenCharacters,
	splitTextByMarkedCharacters,
	stripHiddenCharacters,
} from '../extension/shared/hidden-character-scan'
import {
	CHARACTER_RULES,
	formatCodePoint,
	isSpaceSubstitute,
	ruleForCodePoint,
	severity,
} from '../extension/shared/hidden-character-rules'

/**
 * The two interleaved private use runs seen in a real provider response:
 * U+E001/U+E801, U+E002/U+E802, U+E003/U+E803.
 */
const privateUsePayload = '\u{E001}\u{E801}\u{E002}\u{E802}\u{E003}\u{E803}'

describe('scanText', () => {
	it('flags the private use pairs of a real provider response', () => {
		const response = `Treats workflows as directed graphs.${privateUsePayload} Features include human-in-the-loop (HITL) pause/resume, time-travel debugging, and granular state control.`

		const report = scanText(response)

		expect(report.total).toBe(6)
		expect(report.byRule.map((entry) => [entry.id, entry.count])).toEqual([['private-use', 6]])
		expect(report.byCodePoint.map((entry) => entry.codePoint)).toEqual([
			0xe001, 0xe002, 0xe003, 0xe801, 0xe802, 0xe803,
		])
		expect(report.byCodePoint.map((entry) => entry.formatted)).toEqual([
			'U+E001',
			'U+E002',
			'U+E003',
			'U+E801',
			'U+E802',
			'U+E803',
		])
	})

	it('leaves ordinary text and emoji alone', () => {
		expect(scanText('Plain prose with punctuation, numbers 123 and emoji \u{1F44B}\u{1F3FD}.').total).toBe(0)
		expect(scanText('').total).toBe(0)
	})

	it('groups findings by rule in the order of the rules table', () => {
		const report = scanText(`start\u200Bmiddle\uFE0Fend\u00A0`)

		expect(report.total).toBe(3)
		expect(report.byRule.map((entry) => entry.id)).toEqual([
			'zero-width-space',
			'variation-selector',
			'space-look-alike',
		])
		expect(report.byRule.map((entry) => entry.severity)).toEqual([
			severity.hidden,
			severity.ambiguous,
			severity.spacing,
		])
	})

	it('counts astral code points once, not once per UTF-16 unit', () => {
		const tagCharacters = '\u{E0001}\u{E0002}\u{E007F}'

		expect(tagCharacters.length, 'three tag characters occupy six UTF-16 units').toBe(6)

		const report = scanText(tagCharacters)

		expect(report.total).toBe(3)
		expect(report.byRule[0]?.id).toBe('unicode-tags')
	})

	it('reports the emoji joiner as a finding, since the same code point hides data', () => {
		const familyEmoji = '\u{1F468}\u200D\u{1F469}\u200D\u{1F467}'

		const report = scanText(familyEmoji)

		expect(report.total).toBe(2)
		expect(report.byRule[0]?.id).toBe('zero-width-joiner')
	})
})

describe('stripHiddenCharacters', () => {
	it('keeps every ordinary character and drops only the hidden characters', () => {
		const response = `Answer.${privateUsePayload} Done.`

		expect(stripHiddenCharacters(response)).toBe('Answer. Done.')
	})

	it('puts an ordinary space back where a space look-alike stood in for one', () => {
		// Deleting a no-break space would run "abc" and "d" together; the reader
		// saw a space, so the strip has to leave one.
		expect(stripHiddenCharacters(`a\u200Bb\uFEFFc\u00A0d`)).toBe('abc d')
	})

	it('is idempotent', () => {
		const once = stripHiddenCharacters(`a\u200Bb\uFEFFc\u00A0d`)

		expect(once).toBe('abc d')
		expect(stripHiddenCharacters(once)).toBe('abc d')
	})
})

describe('blank filler characters', () => {
	/**
	 * Reported from a real sample: a model wrote the spaces as U+2800 BRAILLE
	 * PATTERN BLANK and U+3164 HANGUL FILLER. Neither was in the rules table, so
	 * the "cleaned" text still carried them.
	 */
	const sample = `When\u2800architecting\u3164a household\u200C companion`

	it('detects the blank fillers alongside the joiners', () => {
		const report = scanText(sample)

		expect(report.total).toBe(3)
		expect(report.byRule.map((entry) => entry.id)).toEqual(['zero-width-joiner', 'blank-filler'])
		expect(report.byCodePoint.map((entry) => entry.formatted)).toEqual(['U+200C', 'U+2800', 'U+3164'])
	})

	it('restores an ordinary space where a blank filler stood in for one', () => {
		expect(stripHiddenCharacters(sample)).toBe('When architecting a household companion')
	})

	it('leaves nothing hidden behind after a strip', () => {
		expect(scanText(stripHiddenCharacters(sample)).total).toBe(0)
	})
})

describe('splitTextByHiddenCharacters', () => {
	it('returns the text unchanged when there is nothing to find', () => {
		expect(splitTextByHiddenCharacters('plain')).toEqual([{ kind: segmentKind.text, value: 'plain' }])
		expect(splitTextByHiddenCharacters('')).toEqual([])
	})

	it('keeps the original text recoverable', () => {
		const response = `Before\u200B\u{E0001}\u00A0after`
		const segments = splitTextByHiddenCharacters(response)

		expect(joinTextSegments(segments)).toBe('Beforeafter')
		expect(countHiddenCharacters(segments)).toBe(3)
		expect(
			segments.map((segment) => segment.value).join(''),
			'joining every segment in order rebuilds the original text',
		).toBe(response)
	})

	it('marks each finding with the rule that matched it', () => {
		expect(splitTextByHiddenCharacters('\u{E0100}')).toMatchObject([
			{ kind: segmentKind.hiddenCharacter, codePoint: 0xe0100, rule: { id: 'variation-selector' } },
		])
	})
})

describe('splitTextByMarkedCharacters', () => {
	it('marks only the code points the caller selected', () => {
		const segments = splitTextByMarkedCharacters('a\u200Bb\u00A0c', (codePoint) => codePoint === 0x200b)

		expect(segments).toMatchObject([
			{ kind: segmentKind.text, value: 'a' },
			{ kind: segmentKind.hiddenCharacter, codePoint: 0x200b, rule: { id: 'zero-width-space' } },
			{ kind: segmentKind.text, value: 'b\u00A0c' },
		])
	})

	it('keeps the original text recoverable and never yields two text segments in a row', () => {
		const text = 'a\u200B\u00A0b'
		const segments = splitTextByMarkedCharacters(text, (codePoint) => codePoint === 0x00a0)

		expect(segments.map((segment) => segment.kind)).toEqual([
			segmentKind.text,
			segmentKind.hiddenCharacter,
			segmentKind.text,
		])
		expect(segments.map((segment) => segment.value).join('')).toBe(text)
	})

	it('leaves the whole string as text when nothing is selected', () => {
		expect(splitTextByMarkedCharacters('a\u200B\u00A0b', () => false)).toEqual([
			{ kind: segmentKind.text, value: 'a\u200B\u00A0b' },
		])
	})

	it('selects astral code points the same way the scanner counts them', () => {
		const segments = splitTextByMarkedCharacters('a\u{E0001}b', (codePoint) => codePoint === 0xe0001)

		expect(segments).toMatchObject([
			{ kind: segmentKind.text, value: 'a' },
			{ kind: segmentKind.hiddenCharacter, codePoint: 0xe0001, rule: { id: 'unicode-tags' } },
			{ kind: segmentKind.text, value: 'b' },
		])
	})
})

describe('mergeScanReports', () => {
	it('adds per-element reports up to a page report', () => {
		const merged = mergeScanReports([scanText('\u200B\u200B'), scanText('\u200B\u00A0')])

		expect(merged.total).toBe(4)
		expect(merged.byRule.map((entry) => [entry.id, entry.count])).toEqual([
			['zero-width-space', 3],
			['space-look-alike', 1],
		])
		expect(
			merged.byCodePoint.map((entry) => [entry.formatted, entry.count]),
			'code points are listed most frequent first',
		).toEqual([
			['U+200B', 3],
			['U+00A0', 1],
		])
	})

	it('handles an empty page', () => {
		expect(mergeScanReports([])).toEqual({ total: 0, byRule: [], byCodePoint: [] })
	})
})

describe('rules table', () => {
	it('uses unique ids and known severities', () => {
		const ids = CHARACTER_RULES.map((rule) => rule.id)
		expect(new Set(ids).size, 'rule ids are unique').toBe(ids.length)

		const knownSeverities = new Set<string>(Object.values(severity))
		for (const rule of CHARACTER_RULES) {
			expect(knownSeverities.has(rule.severity), `${rule.id} has a known severity`).toBe(true)
			expect(rule.label.length > 0, `${rule.id} has a label`).toBe(true)
			expect(rule.note.length > 0, `${rule.id} explains itself`).toBe(true)
			expect(rule.ranges.length > 0, `${rule.id} has at least one range`).toBe(true)
		}
	})

	it('describes ranges that are ordered and never overlap', () => {
		const ranges = CHARACTER_RULES.flatMap((rule) =>
			rule.ranges.map(([start, end]) => ({ rule: rule.id, start, end })),
		).sort((left, right) => left.start - right.start)

		for (const range of ranges) {
			expect(range.start <= range.end, `${range.rule} has an ordered range`).toBe(true)
		}

		for (let index = 1; index < ranges.length; index += 1) {
			const previous = ranges[index - 1]
			const current = ranges[index]
			if (previous === undefined || current === undefined) break

			expect(
				current.start > previous.end,
				`${current.rule} overlaps ${previous.rule} around ${formatCodePoint(current.start)}`,
			).toBe(true)
		}
	})

	it('classifies code points that no rule covers as ordinary text', () => {
		expect(ruleForCodePoint('a'.codePointAt(0) ?? 0)).toBeNull()
		expect(ruleForCodePoint(0x1f44b), 'the waving hand emoji is not suspicious').toBeNull()
		expect(ruleForCodePoint(0xf8ff)?.id).toBe('private-use')
	})

	it('treats every space variant as a space substitute', () => {
		// A space variant that a strip deleted outright would run two words
		// together, which is the bug the blank fillers were reported for.
		for (const rule of CHARACTER_RULES) {
			if (rule.severity !== severity.spacing) continue

			expect(isSpaceSubstitute(rule), `${rule.id} restores a space`).toBe(true)
		}
	})
})

describe('formatCodePoint', () => {
	it('pads to at least four hex digits and uppercases them', () => {
		expect(formatCodePoint(0x00ad)).toBe('U+00AD')
		expect(formatCodePoint(0x200b)).toBe('U+200B')
		expect(formatCodePoint(0xe0001)).toBe('U+E0001')
		expect(formatCodePoint(0x10fffd)).toBe('U+10FFFD')
	})
})
