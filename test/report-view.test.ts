/**
 * `groupReport` decides what the report's three accordions contain, so it is
 * worth pinning down on its own: which groups appear, in what order, and which
 * characters fall under each rule. The DOM half of the report is checked in the
 * browser pass, because the toggle buttons only exist in a document.
 */

import { describe, expect, it } from 'vitest'

import { severity } from '../extension/shared/hidden-character-rules'
import { scanText } from '../extension/shared/hidden-character-scan'
import { groupReport } from '../extension/shared/report-view'

describe('groupReport', () => {
	it('reports nothing for a page with nothing hidden', () => {
		expect(groupReport(scanText('plain prose'))).toEqual([])
	})

	it('splits findings into severity groups in reporting order', () => {
		const groups = groupReport(scanText('\u200B\u200B\u00A0\u{E0001}'))

		expect(groups.map((group) => [group.severity, group.total])).toEqual([
			[severity.hidden, 3],
			[severity.spacing, 1],
		])
	})

	it('attaches each character to the rule that matched it', () => {
		const groups = groupReport(scanText('\u200B\u200B\u00A0'))
		const errors = groups[0]
		const info = groups[1]

		expect(errors?.rules.map((rule) => [rule.id, rule.count])).toEqual([['zero-width-space', 2]])
		expect(errors?.rules[0]?.codePoints.map((entry) => entry.formatted)).toEqual(['U+200B'])
		expect(info?.rules.map((rule) => rule.id)).toEqual(['space-look-alike'])
	})

	it('keeps the rules table ordering inside a group', () => {
		const groups = groupReport(scanText('\u{E0001}\u{E001}'))

		expect(groups[0]?.rules.map((rule) => rule.id)).toEqual(['unicode-tags', 'private-use'])
	})

	it('drops the groups with no findings', () => {
		const groups = groupReport(scanText('\u00A0'))

		expect(groups.map((group) => group.severity)).toEqual([severity.spacing])
	})
})
