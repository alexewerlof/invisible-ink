/**
 * The guards in the contract module are the only thing standing between an
 * `any`-typed message channel and the rest of the extension, so they are worth
 * pinning down: the focus commands and the optional highlight are the parts that
 * a new command is most likely to forget.
 */

import { describe, expect, it } from 'vitest'

import {
	codePointCommandTypes,
	commandTypes,
	isCommandRequest,
	isCommandResponse,
	isPendingTextRequest,
	isPendingTextResponse,
	messageType,
	requiresCodePoint,
	type CommandType,
	type ScanResult,
} from '../extension/shared/message-contract'

const emptyReport = { total: 0, byRule: [], byCodePoint: [] } as const

function scanResult(overrides: Partial<ScanResult> = {}): ScanResult {
	return { report: emptyReport, sources: 0, revealedCharacters: 0, revealedCodePoints: [], focus: null, ...overrides }
}

/** A request for a command, with the code point the per-character commands need. */
function requestFor(type: CommandType): { type: CommandType; codePoint?: number } {
	return requiresCodePoint(type) ? { type, codePoint: 0x200b } : { type }
}

describe('isCommandRequest', () => {
	it('accepts every command', () => {
		for (const type of commandTypes) {
			expect(isCommandRequest(requestFor(type)), type).toBe(true)
		}
	})

	it('rejects a per-character command without a code point', () => {
		for (const type of codePointCommandTypes) {
			expect(isCommandRequest({ type }), type).toBe(false)
		}
	})

	it('rejects a code point that Unicode does not define', () => {
		const type = messageType.revealCodePoint

		expect(isCommandRequest({ type, codePoint: -1 })).toBe(false)
		expect(isCommandRequest({ type, codePoint: 1.5 })).toBe(false)
		expect(isCommandRequest({ type, codePoint: 0x110000 })).toBe(false)
		expect(isCommandRequest({ type, codePoint: 'U+200B' })).toBe(false)
	})

	it('accepts a code point on a command that does not need one, and still checks it', () => {
		expect(isCommandRequest({ type: messageType.scan, codePoint: 0x200b })).toBe(true)
		expect(isCommandRequest({ type: messageType.scan, codePoint: -1 })).toBe(false)
	})

	it('rejects the messages that are not commands', () => {
		// `report` travels from the page to the worker and `takePendingText` from the
		// inspector to the worker, so neither is something a page detector answers.
		for (const type of [messageType.report, messageType.takePendingText]) {
			expect(isCommandRequest({ type }), type).toBe(false)
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
		const scan = { report: emptyReport, sources: 0, revealedCharacters: 0, revealedCodePoints: [] }
		expect(isCommandResponse({ ok: true, changed: 0, scan })).toBe(false)
	})

	it('rejects a scan that does not say which code points are revealed', () => {
		const scan = { report: emptyReport, sources: 0, revealedCharacters: 0, focus: null }
		expect(isCommandResponse({ ok: true, changed: 0, scan })).toBe(false)
	})

	it('rejects a revealed code point that Unicode does not define', () => {
		const scan = scanResult({ revealedCodePoints: [0x200b, 0x110000] })
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

describe('the pending-text handshake', () => {
	it('accepts the request and nothing that merely looks like it', () => {
		expect(isPendingTextRequest({ type: messageType.takePendingText })).toBe(true)
		expect(isPendingTextRequest({ type: messageType.scan })).toBe(false)
		expect(isPendingTextRequest({})).toBe(false)
		expect(isPendingTextRequest(null)).toBe(false)
	})

	it('accepts an answer that holds text, and one that holds nothing', () => {
		expect(isPendingTextResponse({ text: 'a selection' })).toBe(true)
		// "Nothing was waiting" crosses the channel as an explicit null, not as a
		// missing field, so the guard has to accept it.
		expect(isPendingTextResponse({ text: null })).toBe(true)
	})

	it('rejects an answer that is not a string or null', () => {
		expect(isPendingTextResponse({ text: 7 })).toBe(false)
		expect(isPendingTextResponse({})).toBe(false)
		expect(isPendingTextResponse('a selection')).toBe(false)
	})
})
