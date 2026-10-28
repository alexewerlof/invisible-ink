/**
 * The two-step confirmation both panels use for Remove.
 *
 * Removing is the one command that edits the page rather than the view: the
 * characters are gone and no Hide brings them back. So the button that runs it
 * is a quiet trigger, and the destructive action itself sits behind a second
 * click, with the explanation beside it.
 */

/** The elements a confirmation is built from. */
export interface ConfirmActionOptions {
	/** The button that opens the confirmation. Hidden while the confirmation shows. */
	readonly trigger: HTMLButtonElement
	/** The block that holds the explanation and the two answers. */
	readonly panel: HTMLElement
	/** The button that actually runs the action. */
	readonly confirmButton: HTMLButtonElement
	/** The button that backs out, returning focus to the trigger. */
	readonly cancelButton: HTMLButtonElement
	/** Runs after the confirmation closes, so a failed command cannot leave it open. */
	readonly onConfirm: () => void
}

/** Wire a trigger, a confirmation block and its two answers together. */
export class ConfirmAction {
	private readonly trigger: HTMLButtonElement
	private readonly panel: HTMLElement
	private readonly confirmButton: HTMLButtonElement

	constructor({ trigger, panel, confirmButton, cancelButton, onConfirm }: ConfirmActionOptions) {
		this.trigger = trigger
		this.panel = panel
		this.confirmButton = confirmButton

		trigger.addEventListener('click', () => {
			this.open()
		})

		cancelButton.addEventListener('click', () => {
			this.close()
			trigger.focus()
		})

		confirmButton.addEventListener('click', () => {
			this.close()
			onConfirm()
		})
	}

	/** Whether the confirmation is showing. */
	get isOpen(): boolean {
		return !this.panel.hidden
	}

	/** Reveal the confirmation and put focus on its safe-to-undo sibling. */
	open(): void {
		if (this.isOpen) return

		this.trigger.hidden = true
		this.panel.hidden = false
		this.confirmButton.focus()
	}

	/** Put the trigger back, whether the reader cancelled or the action ran. */
	close(): void {
		if (!this.isOpen) return

		this.panel.hidden = true
		this.trigger.hidden = false
	}
}
