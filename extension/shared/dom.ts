/**
 * Typed lookups for the documents this extension owns.
 *
 * The markup and the script that reads it ship together, so a missing element is
 * a mistake in the pair rather than something a reader can recover from: these
 * helpers throw instead of returning `null`, which turns a typo in an id into an
 * error at startup rather than a silent no-op somewhere further down.
 */

/** Look up an element by id, or throw naming the id that was not found. */
export function requireElement(id: string): HTMLElement {
	const element = document.getElementById(id)
	if (element === null) throw new Error(`The markup has no #${id} element.`)
	return element
}

/** Look up a button, checking that `disabled` is safe to set. */
export function requireButton(id: string): HTMLButtonElement {
	const element = requireElement(id)
	if (!(element instanceof HTMLButtonElement)) {
		throw new Error(`The markup has #${id} as a ${element.tagName}, not a button.`)
	}
	return element
}

/** Look up a text area, checking that `value` is safe to read and write. */
export function requireTextArea(id: string): HTMLTextAreaElement {
	const element = requireElement(id)
	if (!(element instanceof HTMLTextAreaElement)) {
		throw new Error(`The markup has #${id} as a ${element.tagName}, not a textarea.`)
	}
	return element
}

/** Whether the reader asked for less motion, for scroll and animation choices. */
export function prefersReducedMotion(): boolean {
	return window.matchMedia('(prefers-reduced-motion: reduce)').matches
}
