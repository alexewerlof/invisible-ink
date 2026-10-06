/**
 * The guards in the contract module are the only thing standing between an
 * `any`-typed message channel and the rest of the extension, so they are worth
 * pinning down: the focus commands and the optional highlight are the parts that
 * a new command is most likely to forget.
 */

import { describe, expect, it } from 'vitest'

import { isCommandRequest, isCommandResponse, messageType, type ScanResult } from '../extension/shared/message-contract'

const emptyReport = { total: 0, byRule: [], byCodePoint: [] } as const

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
	return { report: emptyReport, sources: 0, revealedCharacters: 0, focus: null, ...overrides }
}

describe('isCommandRequest', () => {
	it('accepts every command and rejects the badge report', () => {
		for (const type of Object.values(messageType)) {
			// `report` travels from the page to the worker, so it is not a command.
			expect(isCommandRequest({ type }), type).toBe(type !== messageType.report)
		}
	})

	it('rejects a type it does not know', () => {
		expect(isCommandRequest({ type: 'invisible-ink:nope' })).toBe(false)
		expect(isCommandRequest({ type: 7 })).toBe(false)
		expect(isCommandRequest(null)).toBe(false)
	})
})

describe('isCommandResponse', () => {
	it('accepts a scan that highlights nothing', () => {
		expect(isCommandResponse({ ok: true, changed: 0, scan: scanResult() })).toBe(true)
	})

	it('accepts a highlighted finding', () => {
		const scan = scanResult({ focus: { index: 2, total: 5 } })
		expect(isCommandResponse({ ok: true, changed: 0, scan })).toBe(true)
	})

	it('rejects a scan that is missing the focus field', () => {
		const scan = { report: emptyReport, sources: 0, revealedCharacters: 0 }
		expect(isCommandResponse({ ok: true, changed: 0, scan })).toBe(false)
	})

	it('rejects a highlight that is not a complete, non-negative position', () => {
		const withoutTotal = { report: emptyReport, sources: 0, revealedCharacters: 0, focus: { index: 2 } }
		const negativeIndex = { report: emptyReport, sources: 0, revealedCharacters: 0, focus: { index: -1, total: 5 } }

		expect(isCommandResponse({ ok: true, changed: 0, scan: withoutTotal })).toBe(false)
		expect(isCommandResponse({ ok: true, changed: 0, scan: negativeIndex })).toBe(false)
	})

	it('accepts the failure answer', () => {
		expect(isCommandResponse({ ok: false, reason: 'the page said no' })).toBe(true)
	})
})
