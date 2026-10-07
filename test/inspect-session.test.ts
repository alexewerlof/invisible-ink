/**
 * `LocalInspection` is the paste-in inspector's whole brain: because it works on a
 * string rather than on a page, every command the page offers can be checked here
 * without a browser. The cases below pin the behaviours the popup relies on too —
 * wrapping focus, revealing before stepping, and putting an ordinary space back
 * where a space look-alike stood in for one.
 */

import { describe, expect, it } from 'vitest'

import { LocalInspection } from '../extension/shared/inspect-session'
import { messageType, type CommandType, type ScanResult } from '../extension/shared/message-contract'

/** Two findings on two lines: a zero-width space and a no-break space. */
const sample = 'first\u200Bline\nsecond\u00A0line\nplain line'

function scanAfter(session: LocalInspection, type: CommandType): ScanResult {
	const response = session.run(type)
	if (!response.ok) throw new Error('a local command never fails')
	return response.scan
}

function changedBy(session: LocalInspection, type: CommandType): number {
	const response = session.run(type)
	if (!response.ok) throw new Error('a local command never fails')
	return response.changed
}

describe('LocalInspection', () => {
	it('counts the findings and the lines they sit on', () => {
		const scan = scanAfter(new LocalInspection(sample), messageType.scan)

		expect(scan.report.total).toBe(2)
		expect(scan.sources).toBe(2)
		expect(scan.focus).toBeNull()
	})

	it('shows the markers on arrival, because marking the text is the point', () => {
		const session = new LocalInspection(sample)

		expect(session.isRevealed).toBe(true)
		expect(scanAfter(session, messageType.scan).revealedCharacters).toBe(2)
	})

	it('reports nothing for text with no hidden characters', () => {
		const scan = scanAfter(new LocalInspection('perfectly ordinary text'), messageType.scan)

		expect(scan.report.total).toBe(0)
		expect(scan.sources).toBe(0)
		expect(scan.focus).toBeNull()
	})

	it('counts the marks as revealed only while the marked view is showing', () => {
		const session = new LocalInspection(sample)

		expect(scanAfter(session, messageType.hide).revealedCharacters).toBe(0)
		expect(session.isRevealed).toBe(false)

		expect(scanAfter(session, messageType.reveal).revealedCharacters).toBe(2)
		expect(session.isRevealed).toBe(true)
	})

	it('reveals the text when the reader starts walking the findings', () => {
		const session = new LocalInspection(sample)
		session.run(messageType.hide)
		expect(session.isRevealed).toBe(false)

		scanAfter(session, messageType.focusFirst)

		expect(session.isRevealed).toBe(true)
	})

	it('walks the findings and wraps at both ends', () => {
		const session = new LocalInspection(sample)

		expect(scanAfter(session, messageType.focusFirst).focus).toEqual({ index: 0, total: 2 })
		expect(scanAfter(session, messageType.focusNext).focus).toEqual({ index: 1, total: 2 })
		expect(scanAfter(session, messageType.focusNext).focus).toEqual({ index: 0, total: 2 })
		expect(scanAfter(session, messageType.focusPrevious).focus).toEqual({ index: 1, total: 2 })
	})

	it('highlights nothing when there is nothing hidden', () => {
		const session = new LocalInspection('plain text')
		expect(scanAfter(session, messageType.focusFirst).focus).toBeNull()
	})

	it('removes the findings and puts a space back where one stood in for a space', () => {
		const session = new LocalInspection(sample)

		expect(changedBy(session, messageType.remove)).toBe(2)
		expect(session.value).toBe('firstline\nsecond line\nplain line')
		expect(scanAfter(session, messageType.scan).report.total).toBe(0)
	})

	it('keeps the reveal choice across new text but drops the highlight', () => {
		const session = new LocalInspection(sample)
		scanAfter(session, messageType.reveal)
		scanAfter(session, messageType.focusFirst)

		session.setText('another\u200Btext')

		expect(session.value).toBe('another\u200Btext')
		expect(session.isRevealed).toBe(true)

		const scan = scanAfter(session, messageType.scan)
		expect(scan.report.total).toBe(1)
		expect(scan.focus).toBeNull()
	})
})
