/**
 * `isRestrictedPageUrl` is the popup's shortcut around a call that Chrome can
 * only reject, so what matters is that it names the browser-owned schemes and
 * nothing else. A false positive would silently refuse an ordinary page; a false
 * negative merely restores the old throw-and-catch path, which is why the Web
 * Store and `file://` cases below stay on the "try it" side.
 *
 * `requestInTab` still throws when a page refuses the content script, because
 * that refusal is the only thing Chrome says about an origin no extension can
 * touch. The second block pins down that a caller can tell this expected answer
 * apart from a detector that fails some other way.
 */

import { afterEach, describe, expect, it, vi } from 'vitest'

import { messageType, type CommandResponse } from '../extension/shared/message-contract'
import { isRestrictedPageUrl, requestInTab, UninspectablePageError } from '../extension/shared/tab-messaging'

/** A page with nothing hidden, which is all `isCommandResponse` has to accept. */
const emptyScanAnswer: CommandResponse = {
	ok: true,
	changed: 0,
	scan: {
		report: { total: 0, byRule: [], byCodePoint: [] },
		sources: 0,
		revealedCharacters: 0,
		revealedCodePoints: [],
		focus: null,
	},
}

describe('isRestrictedPageUrl', () => {
	it('recognises the browser-owned schemes', () => {
		const restricted = [
			'chrome://settings',
			'chrome://extensions',
			'chrome-untrusted://new-tab-page/',
			'chrome-search://local-ntp/local-ntp.html',
			'chrome-extension://abcdefghijklmnop/popup/popup.html',
			'edge://settings',
			'about:blank',
			'view-source:https://example.com',
			'devtools://devtools/bundled/inspector.html',
		]

		for (const url of restricted) {
			expect(isRestrictedPageUrl(url), url).toBe(true)
		}
	})

	it('ignores the case of the scheme', () => {
		expect(isRestrictedPageUrl('CHROME://SETTINGS')).toBe(true)
	})

	it('allows ordinary pages', () => {
		const allowed = [
			'https://example.com/page',
			'http://localhost:3000/',
			// The Web Store is an https page even though Chrome refuses to inject
			// into it, so the caller's fallback still has to handle that throw.
			'https://chromewebstore.google.com/detail/invisible-ink',
			// A file page can host the detector once the user grants file access.
			'file:///tmp/hidden-characters-page.html',
		]

		for (const url of allowed) {
			expect(isRestrictedPageUrl(url), url).toBe(false)
		}
	})

	it('does not treat a missing or unparseable URL as restricted', () => {
		// The popup often has no `tab.url`; falling through to the messaging
		// fallback is the safe answer, so these must not block the attempt.
		expect(isRestrictedPageUrl(undefined)).toBe(false)
		expect(isRestrictedPageUrl('')).toBe(false)
		expect(isRestrictedPageUrl('not a url')).toBe(false)
	})
})

describe('requestInTab', () => {
	afterEach(() => {
		vi.unstubAllGlobals()
	})

	it('names a page that refuses the content script, so the caller can report it quietly', async () => {
		vi.stubGlobal('chrome', {
			tabs: { sendMessage: () => Promise.reject(new Error('Could not establish connection.')) },
			scripting: { executeScript: () => Promise.reject(new Error('Cannot access contents of the page.')) },
		})

		await expect(requestInTab(1, { type: messageType.scan })).rejects.toBeInstanceOf(UninspectablePageError)
	})

	it('injects the detector and asks again when nothing was listening', async () => {
		const sendMessage = vi
			.fn<() => Promise<unknown>>()
			.mockRejectedValueOnce(new Error('Could not establish connection.'))
			.mockResolvedValue(emptyScanAnswer)
		const executeScript = vi.fn<() => Promise<unknown>>().mockResolvedValue([])

		vi.stubGlobal('chrome', { tabs: { sendMessage }, scripting: { executeScript } })

		await expect(requestInTab(1, { type: messageType.scan })).resolves.toBe(emptyScanAnswer)
		expect(sendMessage).toHaveBeenCalledTimes(2)
		expect(executeScript).toHaveBeenCalledTimes(1)
	})

	it('forwards the code point of a per-character command', async () => {
		const sendMessage = vi.fn<() => Promise<unknown>>().mockResolvedValue(emptyScanAnswer)

		vi.stubGlobal('chrome', { tabs: { sendMessage }, scripting: { executeScript: () => Promise.resolve([]) } })

		await requestInTab(1, { type: messageType.hideCodePoint, codePoint: 0x200b })

		expect(sendMessage).toHaveBeenCalledWith(
			1,
			{ type: messageType.hideCodePoint, codePoint: 0x200b },
			{ frameId: 0 },
		)
	})

	it('keeps an unrecognisable answer an ordinary error', async () => {
		vi.stubGlobal('chrome', {
			tabs: { sendMessage: () => Promise.resolve({ ok: 'maybe' }) },
			scripting: { executeScript: () => Promise.resolve([]) },
		})

		await expect(requestInTab(1, { type: messageType.scan })).rejects.toThrow('unexpected response')
	})
})
