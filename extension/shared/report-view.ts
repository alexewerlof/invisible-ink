/**
 * The report panel's renderers, shared by the popup and the paste-in inspector.
 *
 * Every renderer takes the list it fills, so each document keeps its own element
 * lookups and the only thing shared is what the entries look like. The wording
 * that is not tied to a page (a label for a total, the `3 / 21` position) lives
 * here too, because both panels say it identically.
 */

import { CHARACTER_RULES, severityLabel } from './hidden-character-rules'
import type { FocusState } from './message-contract'
import type { CodePointCount, RuleCount } from './hidden-character-scan'

/** Code points are listed most frequent first, so a handful is enough context. */
export const visibleCharacterCount = 8

/** `1 element` but `2 elements`, so counts read as prose. */
export function plural(count: number, noun: string): string {
	return count === 1 ? `1 ${noun}` : `${String(count)} ${noun}s`
}

/** The label under the big number. */
export function countLabel(total: number): string {
	return total === 1 ? 'character found' : 'characters found'
}

/** Fill a list with one entry per rule that matched, in the rules table's order. */
export function renderKinds(list: HTMLElement, byRule: readonly RuleCount[]): void {
	list.replaceChildren()

	for (const entry of byRule) {
		const item = document.createElement('li')
		item.className = `ii-panel__kind ii-panel__kind--${entry.severity}`
		item.title = entry.note

		const name = document.createElement('span')
		name.className = 'ii-panel__kind-name'
		name.textContent = `${entry.label} (${severityLabel[entry.severity]})`

		const count = document.createElement('span')
		count.className = 'ii-panel__kind-count'
		count.textContent = String(entry.count)

		item.append(name, count)
		list.append(item)
	}
}

/** Fill a list with a chip per distinct code point, most frequent first. */
export function renderCharacters(list: HTMLElement, byCodePoint: readonly CodePointCount[]): void {
	list.replaceChildren()

	for (const entry of byCodePoint.slice(0, visibleCharacterCount)) {
		list.append(createCharacterChip(`${entry.formatted} x${String(entry.count)}`))
	}

	if (byCodePoint.length > visibleCharacterCount) {
		const hidden = byCodePoint.length - visibleCharacterCount
		list.append(createCharacterChip(`+${String(hidden)} more`))
	}
}

function createCharacterChip(label: string): HTMLLIElement {
	const item = document.createElement('li')
	item.className = 'ii-panel__character'
	item.textContent = label
	return item
}

/** Fill a list with the rules table, so the panel explains exactly what the scanner looks for. */
export function renderLegend(list: HTMLElement): void {
	list.replaceChildren()

	for (const rule of CHARACTER_RULES) {
		const item = document.createElement('li')
		item.className = 'ii-panel__legend-item'

		const name = document.createElement('p')
		name.className = 'ii-panel__legend-name'
		name.textContent = `${rule.label} (${severityLabel[rule.severity]})`

		const note = document.createElement('p')
		note.className = 'ii-panel__legend-note'
		note.textContent = rule.note

		item.append(name, note)
		list.append(item)
	}
}

/** The `3 / 21` position readout, or an empty string while nothing is highlighted. */
export function focusLabel(focus: FocusState | null): string {
	return focus === null ? '' : `${String(focus.index + 1)} / ${String(focus.total)}`
}

/** The sentence Show/Next/Prev report, since they move the reader rather than the text. */
export function describeFocus(focus: FocusState | null): string {
	if (focus === null) return ''
	return `Showing ${String(focus.index + 1)} of ${String(focus.total)}.`
}
