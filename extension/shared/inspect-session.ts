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
	 * The marked view starts on: showing the text with its hidden characters
	 * marked is the whole point of this surface, so the reader does not have to
	 * ask for it. The button then offers to hide the markers.
	 */
	private revealed = true
	private focusedIndex = -1

	constructor(text = '') {
		this.text = text
	}

	/** The text as it stands now, which is what the caller writes back to its field. */
	get value(): string {
		return this.text
	}

	/** Whether the marked view is showing. */
	get isRevealed(): boolean {
		return this.revealed
	}

	private readonly commands: Record<CommandType, () => number> = {
		[messageType.scan]: () => 0,
		[messageType.reveal]: () => this.setRevealed(true),
		[messageType.hide]: () => this.setRevealed(false),
		[messageType.remove]: () => this.removeAll(),
		[messageType.focusFirst]: () => this.focus(0),
		[messageType.focusNext]: () => this.focus(1),
		[messageType.focusPrevious]: () => this.focus(-1),
	}

	/** Start over with new text, keeping the reader's reveal choice but dropping the highlight. */ setText(
		text: string,
	): void {
		this.text = text
		this.focusedIndex = -1
	}

	/** Run one command and answer in the shape both report panels render. */
	run(type: CommandType): CommandResponse {
		const changed = this.commands[type]()
		return { ok: true, changed, scan: this.snapshot() }
	}

	private setRevealed(revealed: boolean): number {
		this.revealed = revealed
		if (!revealed) this.focusedIndex = -1
		return 0
	}

	/** Delete every finding, putting an ordinary space back where one stood in for a space. */
	private removeAll(): number {
		const changed = this.count()
		this.text = stripHiddenCharacters(this.text)
		this.focusedIndex = -1
		return changed
	}

	/**
	 * Move the highlight. A step of 0 starts a fresh tour at the first finding and
	 * reveals the text, mirroring the detector's Show; every other step wraps
	 * around at either end.
	 */
	private focus(step: number): number {
		this.revealed = true

		const total = this.count()
		if (total === 0) {
			this.focusedIndex = -1
			return 0
		}

		this.focusedIndex = step === 0 ? 0 : nextMarkIndex(this.focusedIndex, step, total)
		return 0
	}

	private count(): number {
		return scanText(this.text).total
	}

	private snapshot(): ScanResult {
		const report = scanText(this.text)

		return {
			report,
			sources: countAffectedLines(this.text),
			revealedCharacters: this.revealed ? report.total : 0,
			focus: this.readFocus(report.total),
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
