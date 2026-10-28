/**
 * A hidden-character session over text the caller owns.
 *
 * The paste-in inspector has no page to ask: the text lives in a textarea. This
 * class runs the same command vocabulary the page detector answers, but purely
 * on a string, so the page's whole behaviour can be exercised from Node with no
 * DOM (see `test/inspect-session.test.ts`). It reuses the scanning helpers, so
 * "what counts as hidden" still has exactly one definition.
 */

import { nextMarkIndex } from './hidden-character-mark'
import { scanText, stripHiddenCharacters } from './hidden-character-scan'
import {
	messageType,
	requiresCodePoint,
	type CommandResponse,
	type CommandType,
	type FocusState,
	type ScanResult,
} from './message-contract'

/** How many lines of the text carry at least one finding. */
function countAffectedLines(text: string): number {
	let lines = 0

	for (const line of text.split('\n')) {
		if (scanText(line).total > 0) lines += 1
	}

	return lines
}

export class LocalInspection {
	private text: string
	/**
	 * The code points the marked view is showing, and so the reader has switched
	 * on. Marking the text is the point of this surface, so everything present
	 * starts selected.
	 */
	private selection = new Set<number>()
	private focusedIndex = -1

	constructor(text = '') {
		this.text = text
		this.resetSelection()
	}

	/** The text as it stands now, which is what the caller writes back to its field. */
	get value(): string {
		return this.text
	}

	/** Whether anything is marked. */
	get isRevealed(): boolean {
		return this.selection.size > 0
	}

	private readonly commands: Record<CommandType, (codePoint?: number) => number> = {
		[messageType.scan]: () => 0,
		[messageType.reveal]: () => this.revealAll(),
		[messageType.hide]: () => this.hideAll(),
		[messageType.revealCodePoint]: (codePoint) => this.revealCodePoint(codePoint),
		[messageType.hideCodePoint]: (codePoint) => this.hideCodePoint(codePoint),
		[messageType.remove]: () => this.removeAll(),
		[messageType.focusFirst]: () => this.focus(0),
		[messageType.focusNext]: () => this.focus(1),
		[messageType.focusPrevious]: () => this.focus(-1),
	}

	/**
	 * Start over with new text, marking every finding in it and dropping the
	 * highlight. Marking is this surface's default, so a new paste does not arrive
	 * hidden just because the previous text had been hidden.
	 */
	setText(text: string): void {
		this.text = text
		this.focusedIndex = -1
		this.resetSelection()
	}

	/** Run one command and answer in the shape both report panels render. */
	run(type: CommandType, codePoint?: number): CommandResponse {
		// The detector's guard rejects this before the command arrives; here the
		// same rule has to be enforced locally, because the inspector calls the
		// session directly.
		if (requiresCodePoint(type) && codePoint === undefined) {
			return { ok: false, reason: `${type} needs a code point.` }
		}

		const changed = this.commands[type](codePoint)
		return { ok: true, changed, scan: this.snapshot() }
	}

	/** Select everything the text contains, so every finding is marked. */
	private revealAll(): number {
		const changed = this.count() - this.revealedCount()
		this.resetSelection()
		return changed
	}

	/** Unselect everything, so the text reads as it is. */
	private hideAll(): number {
		const changed = this.revealedCount()
		this.selection.clear()
		this.focusedIndex = -1
		return changed
	}

	private revealCodePoint(codePoint?: number): number {
		if (codePoint === undefined || this.selection.has(codePoint)) return 0

		this.selection.add(codePoint)
		return this.countOf(codePoint)
	}

	private hideCodePoint(codePoint?: number): number {
		if (codePoint === undefined || !this.selection.has(codePoint)) return 0

		this.selection.delete(codePoint)
		this.focusedIndex = -1
		return this.countOf(codePoint)
	}

	/** Delete every finding, putting an ordinary space back where one stood in for a space. */
	private removeAll(): number {
		const changed = this.count()
		this.text = stripHiddenCharacters(this.text)
		this.focusedIndex = -1
		this.resetSelection()
		return changed
	}

	/**
	 * Move the highlight. A step of 0 starts a fresh tour at the first finding and
	 * reveals the text, mirroring the detector's Show; every other step wraps
	 * around at either end.
	 */
	private focus(step: number): number {
		// As on a page, walking the findings is not "show everything": a reader who
		// turned one kind off keeps that choice while they step through the rest.
		const changed = this.selection.size === 0 ? this.revealAll() : 0
		const total = this.revealedCount()

		if (total === 0) {
			this.focusedIndex = -1
			return changed
		}

		this.focusedIndex = step === 0 ? 0 : nextMarkIndex(this.focusedIndex, step, total)
		return changed
	}

	/** Select the findings that are present, which is what a fresh text starts with. */
	private resetSelection(): void {
		this.selection = new Set(scanText(this.text).byCodePoint.map((entry) => entry.codePoint))
	}

	private count(): number {
		return scanText(this.text).total
	}

	private countOf(codePoint: number): number {
		const entry = scanText(this.text).byCodePoint.find((candidate) => candidate.codePoint === codePoint)
		return entry?.count ?? 0
	}

	/** How many occurrences are currently marked. */
	private revealedCount(): number {
		let total = 0

		for (const entry of scanText(this.text).byCodePoint) {
			if (this.selection.has(entry.codePoint)) total += entry.count
		}

		return total
	}

	private snapshot(): ScanResult {
		const report = scanText(this.text)
		const revealedCharacters = this.revealedCount()

		return {
			report,
			sources: countAffectedLines(this.text),
			revealedCharacters,
			revealedCodePoints: [...this.selection].sort((left, right) => left - right),
			focus: this.readFocus(revealedCharacters),
		}
	}

	/** The highlight to report, or `null` when it no longer fits the text. */
	private readFocus(markCount: number): FocusState | null {
		if (this.focusedIndex < 0 || this.focusedIndex >= markCount) {
			this.focusedIndex = -1
			return null
		}

		return { index: this.focusedIndex, total: markCount }
	}
}
