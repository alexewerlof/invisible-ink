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

function scanAfter(session: LocalInspection, type: CommandType, codePoint?: number): ScanResult {
	const response = session.run(type, codePoint)
	if (!response.ok) throw new Error('a local command never fails')
	return response.scan
}

function changedBy(session: LocalInspection, type: CommandType, codePoint?: number): number {
	const response = session.run(type, codePoint)
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

	it('marks and unmarks one code point without touching the others', () => {
		const session = new LocalInspection(sample)

		expect(changedBy(session, messageType.hideCodePoint, 0x200b)).toBe(1)

		const afterHiding = scanAfter(session, messageType.scan)
		expect(afterHiding.revealedCodePoints).toEqual([0x00a0])
		expect(afterHiding.revealedCharacters).toBe(1)
		expect(afterHiding.report.total, 'hiding never changes the findings').toBe(2)

		expect(changedBy(session, messageType.revealCodePoint, 0x200b)).toBe(1)
		expect(scanAfter(session, messageType.scan).revealedCodePoints).toEqual([0x00a0, 0x200b])
	})

	it("leaves the reader's choice alone when they walk the findings", () => {
		const session = new LocalInspection(sample)
		session.run(messageType.hideCodePoint, 0x200b)

		const scan = scanAfter(session, messageType.focusFirst)

		expect(scan.revealedCodePoints, 'stepping does not switch the hidden kind back on').toEqual([0x00a0])
		expect(scan.focus).toEqual({ index: 0, total: 1 })
	})

	it('refuses a per-character command that names no code point', () => {
		const response = new LocalInspection(sample).run(messageType.hideCodePoint)

		expect(response.ok).toBe(false)
	})

	it('marks every finding again after new text arrives', () => {
		const session = new LocalInspection(sample)
		session.run(messageType.hide)

		session.setText('another\u200Btext')

		expect(scanAfter(session, messageType.scan).revealedCodePoints).toEqual([0x200b])
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
