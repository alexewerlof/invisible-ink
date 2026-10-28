/**
 * The report panel's renderers, shared by the popup and the paste-in inspector.
 *
 * The report is grouped into one accordion per severity, and each character
 * inside a group is a button the reader can switch on and off. Both surfaces
 * draw that from here, so the grouping, the labels and the toggle markup have
 * one definition; each document only supplies its own container and its own
 * "is this code point shown?" answer.
 */

import {
	CHARACTER_RULES,
	isSeverity,
	ruleForCodePoint,
	severity,
	severityLabel,
	severityOrder,
	type RuleId,
	type Severity,
} from './hidden-character-rules'
import type { FocusState } from './message-contract'
import type { CodePointCount, HiddenCharacterReport } from './hidden-character-scan'

/** The attribute that ties a checkbox to the code point it acts on. */
const codePointAttribute = 'data-code-point'

/** The class on the checkbox itself, used to find the one that had focus before a re-render. */
const toggleInputClass = 'ii-panel__toggle-input'

/** `1 element` but `2 elements`, so counts read as prose. */
export function plural(count: number, noun: string): string {
	return count === 1 ? `1 ${noun}` : `${String(count)} ${noun}s`
}

/** The label under the big number. */
export function countLabel(total: number): string {
	return total === 1 ? 'character found' : 'characters found'
}

/** How one severity group is introduced in its accordion. */
export interface SeverityGroupMeta {
	/** The emoji beside the group's name. Decorative, so it is hidden from screen readers. */
	readonly emoji: string
	readonly title: string
	/** One sentence explaining how suspicious a finding in this group is. */
	readonly description: string
}

/**
 * The three groups.
 *
 * Keyed by `Severity`, so a new severity cannot be added without naming itself
 * here, and `severityOrder` decides the order the accordions appear in.
 */
export const severityGroup: Record<Severity, SeverityGroupMeta> = {
	[severity.hidden]: {
		emoji: '🚨',
		title: 'Errors',
		description: 'Never needed in ordinary prose, so a hit is very likely deliberate.',
	},
	[severity.ambiguous]: {
		emoji: '⚠️',
		title: 'Warnings',
		description: 'Invisible, but legitimate in emoji, right-to-left and Indic text.',
	},
	[severity.spacing]: {
		emoji: 'ℹ️',
		title: 'Info',
		description: 'Look-alike spaces, only suspicious in large numbers.',
	},
}

/** One rule's share of a severity group, with the characters that matched it. */
export interface GroupedRule {
	readonly id: RuleId
	readonly label: string
	readonly note: string
	readonly count: number
	readonly codePoints: readonly CodePointCount[]
}

/** One accordion's worth of findings. */
export interface SeverityGroupReport {
	readonly severity: Severity
	readonly total: number
	readonly rules: readonly GroupedRule[]
}

/**
 * Group a report by severity.
 *
 * Empty groups are dropped, so a page with only tag characters shows one
 * accordion rather than three, and the rules inside a group keep the ordering of
 * the rules table so the list does not jump between scans.
 */
export function groupReport(report: HiddenCharacterReport): SeverityGroupReport[] {
	const codePointsByRule = new Map<RuleId, CodePointCount[]>()

	for (const entry of report.byCodePoint) {
		const rule = ruleForCodePoint(entry.codePoint)
		if (rule === null) continue

		const codePoints = codePointsByRule.get(rule.id) ?? []
		codePoints.push(entry)
		codePointsByRule.set(rule.id, codePoints)
	}

	const groups: SeverityGroupReport[] = []

	for (const groupSeverity of severityOrder) {
		const rules = report.byRule.filter((entry) => entry.severity === groupSeverity)
		if (rules.length === 0) continue

		groups.push({
			severity: groupSeverity,
			total: rules.reduce((sum, entry) => sum + entry.count, 0),
			rules: rules.map((entry) => ({
				id: entry.id,
				label: entry.label,
				note: entry.note,
				count: entry.count,
				codePoints: codePointsByRule.get(entry.id) ?? [],
			})),
		})
	}

	return groups
}

/** What a toggle does, and how the panel asks whether it is on. */
export interface ReportGroupOptions {
	/** Whether one code point is currently shown as a marker. */
	readonly isRevealed: (codePoint: number) => boolean
	/** Called when the reader turns one code point on or off. */
	readonly onToggle: (codePoint: number) => void
}

/**
 * Draw the grouped report into a container.
 *
 * The container is emptied and rebuilt on every command, because every command
 * answers with a fresh scan. Two things therefore have to survive the rebuild:
 * which accordions the reader opened, and which toggle they were using. Without
 * that, clicking a toggle would collapse its group and drop keyboard focus.
 */
export function renderReportGroups(
	container: HTMLElement,
	groups: readonly SeverityGroupReport[],
	options: ReportGroupOptions,
): void {
	const openGroups = readOpenGroups(container)
	const focusedCodePoint = readFocusedCodePoint(container)

	container.replaceChildren()

	for (const group of groups) {
		container.append(createGroupElement(group, openGroups.has(group.severity), options))
	}

	if (focusedCodePoint === null) return

	const input = [...container.querySelectorAll<HTMLInputElement>(`.${toggleInputClass}`)].find(
		(candidate) => readCodePoint(candidate) === focusedCodePoint,
	)

	input?.focus()
}

/** The groups the reader had opened before this render. */
function readOpenGroups(container: HTMLElement): Set<Severity> {
	const openGroups = new Set<Severity>()

	for (const child of container.children) {
		if (!(child instanceof HTMLDetailsElement) || !child.open) continue
		if (isSeverity(child.dataset.severity)) openGroups.add(child.dataset.severity)
	}

	return openGroups
}

/** The code point of the checkbox that had focus, or `null` when focus was elsewhere. */
function readFocusedCodePoint(container: HTMLElement): number | null {
	const active = document.activeElement
	if (!(active instanceof HTMLInputElement) || !container.contains(active)) return null
	if (!active.classList.contains(toggleInputClass)) return null

	return readCodePoint(active)
}

function readCodePoint(toggle: HTMLElement): number | null {
	const value = Number.parseInt(toggle.getAttribute(codePointAttribute) ?? '', 10)
	return Number.isInteger(value) ? value : null
}

function createGroupElement(
	group: SeverityGroupReport,
	open: boolean,
	options: ReportGroupOptions,
): HTMLDetailsElement {
	const meta = severityGroup[group.severity]

	const details = document.createElement('details')
	details.className = `ii-panel__group ii-panel__group--${group.severity}`
	details.dataset.severity = group.severity
	details.open = open

	const summary = document.createElement('summary')
	summary.className = 'ii-panel__group-summary'

	const emoji = document.createElement('span')
	emoji.className = 'ii-panel__group-emoji'
	emoji.textContent = meta.emoji
	emoji.setAttribute('aria-hidden', 'true')

	const title = document.createElement('span')
	title.className = 'ii-panel__group-title'
	title.textContent = meta.title

	const count = document.createElement('span')
	count.className = 'ii-panel__group-count'
	count.textContent = String(group.total)

	summary.append(emoji, title, count)

	const body = document.createElement('div')
	body.className = 'ii-panel__group-body'

	const description = document.createElement('p')
	description.className = 'ii-panel__group-description'
	description.textContent = meta.description
	body.append(description)

	for (const rule of group.rules) body.append(createRuleElement(rule, options))

	details.append(summary, body)
	return details
}

function createRuleElement(rule: GroupedRule, options: ReportGroupOptions): HTMLElement {
	const section = document.createElement('section')
	section.className = 'ii-panel__rule'

	const name = document.createElement('p')
	name.className = 'ii-panel__rule-name'
	name.textContent = rule.label

	const count = document.createElement('span')
	count.className = 'ii-panel__rule-count'
	count.textContent = String(rule.count)
	name.append(count)

	const note = document.createElement('p')
	note.className = 'ii-panel__rule-note'
	note.textContent = rule.note

	const toggles = document.createElement('div')
	toggles.className = 'ii-panel__toggles'

	for (const entry of rule.codePoints) toggles.append(createToggleRow(entry, options))

	section.append(name, note, toggles)
	return section
}

/**
 * One character as a labelled checkbox: the box, the code point, and how many
 * times it occurs.
 *
 * A checkbox rather than a button because the reader is choosing what to show:
 * ticked means the page has markers for this character, cleared means the text
 * keeps it. The count in the badge says how much of the page one click affects.
 */
function createToggleRow(entry: CodePointCount, options: ReportGroupOptions): HTMLLabelElement {
	const row = document.createElement('label')
	row.className = 'ii-panel__toggle'

	const input = document.createElement('input')
	input.type = 'checkbox'
	input.className = toggleInputClass
	input.checked = options.isRevealed(entry.codePoint)
	input.setAttribute(codePointAttribute, String(entry.codePoint))
	input.setAttribute('aria-label', `${entry.formatted}, ${plural(entry.count, 'occurrence')}`)
	input.title = `Show or hide ${entry.formatted}`
	input.addEventListener('change', () => {
		options.onToggle(entry.codePoint)
	})

	const code = document.createElement('span')
	code.className = 'ii-panel__toggle-code'
	code.textContent = entry.formatted

	const count = document.createElement('span')
	count.className = 'ii-panel__toggle-count'
	count.textContent = String(entry.count)

	row.append(input, code, count)
	return row
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
