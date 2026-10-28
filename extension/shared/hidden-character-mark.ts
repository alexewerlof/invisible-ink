/**
 * Everything a hidden character needs in order to become a marker, plus the
 * marker's class names.
 *
 * The page detector and the paste-in inspector both draw markers, and
 * `content/hidden-character-marks.css` is tied to the class names below by
 * `test/theme.test.ts`, so the marker's shape lives here once instead of twice.
 * The descriptor is plain data on purpose: it is the piece a second renderer, or
 * a test, can consume without touching the DOM.
 */

import { formatCodePoint, isSpaceSubstitute, ruleForCodePoint } from './hidden-character-rules'
import { segmentKind, type HiddenCharacterSegment, type Segment } from './hidden-character-scan'

/** The block name of a marker; the matching CSS lives in content/hidden-character-marks.css. */
export const markBlock = 'ii-hidden-character'

/** A selector that matches every marker. */
export const markSelector = `.${markBlock}`

/** The class the highlighted marker carries; hidden-character-marks.css draws the ring. */
export const activeMarkClass = `${markBlock}--active`

/** The `data-` attribute that keeps the replaced character, so Hide can put it back. */
const markCharacterAttribute = 'iiCharacter'

/** What one hidden character looks like as a marker, without touching the DOM. */
export interface HiddenCharacterMarkDescriptor {
	/** The full class list, including the severity modifier. */
	readonly className: string
	/** The code point in `U+200B` form, which is what the marker reads. */
	readonly label: string
	/** The rule's name, shown on hover. */
	readonly title: string
	/** The accessible name, since the label is a code point rather than a word. */
	readonly ariaLabel: string
	/** The character that was replaced, kept so Hide can restore it. */
	readonly value: string
	/** The same code point as a number, for callers that need to look up its rule. */
	readonly codePoint: number
}

/** Describe one hidden character. The single definition of what a marker means. */
export function describeHiddenCharacter(segment: HiddenCharacterSegment): HiddenCharacterMarkDescriptor {
	const label = formatCodePoint(segment.codePoint)

	return {
		className: `${markBlock} ${markBlock}--${segment.rule.severity}`,
		label,
		title: segment.rule.label,
		ariaLabel: `Hidden character ${label}`,
		value: segment.value,
		codePoint: segment.codePoint,
	}
}

/** Build the marker element for one hidden character. */
export function createHiddenCharacterMark(segment: HiddenCharacterSegment): HTMLSpanElement {
	const descriptor = describeHiddenCharacter(segment)

	const mark = document.createElement('span')
	mark.className = descriptor.className
	mark.dataset[markCharacterAttribute] = descriptor.value
	mark.textContent = descriptor.label
	mark.title = descriptor.title
	mark.setAttribute('role', 'img')
	mark.setAttribute('aria-label', descriptor.ariaLabel)

	return mark
}

/**
 * Build a fragment of a split string where every hidden character is a marker.
 *
 * Replacing a character rather than inserting beside it keeps the text around the
 * markers intact, so the detector can swap one text node for this fragment in a
 * single step.
 */
export function createMarkedFragment(segments: readonly Segment[]): DocumentFragment {
	const fragment = document.createDocumentFragment()

	for (const segment of segments) {
		if (segment.kind === segmentKind.text) fragment.append(segment.value)
		else fragment.append(createHiddenCharacterMark(segment))
	}

	return fragment
}

/** The markers inside a root: the document for the page detector, one pane for the inspector. */
export function collectMarkElements(root: ParentNode = document): HTMLElement[] {
	return [...root.querySelectorAll<HTMLElement>(markSelector)]
}

/** Whether an element is one of our markers. */
export function isMarkElement(element: Element): element is HTMLElement {
	return element.classList.contains(markBlock)
}

/** What a marker replaced: the character itself and its code point. */
export interface MarkedCharacter {
	readonly value: string
	readonly codePoint: number
}

/** Read the character a marker kept, or `null` when it holds nothing usable. */
export function readMarkedCharacter(mark: HTMLElement): MarkedCharacter | null {
	const value = mark.dataset[markCharacterAttribute]
	if (value === undefined) return null

	const codePoint = value.codePointAt(0)
	if (codePoint === undefined) return null

	return { value, codePoint }
}

/** What a removed marker leaves behind: a space if it stood in for one. */
export function markReplacement(mark: HTMLElement): string {
	const marked = readMarkedCharacter(mark)
	const rule = marked === null ? null : ruleForCodePoint(marked.codePoint)
	return rule !== null && isSpaceSubstitute(rule) ? ' ' : ''
}

/**
 * Step through the marks. -1 means nothing was highlighted yet, so a fresh tour
 * starts at the first one going forward and the last one going back.
 */
export function nextMarkIndex(current: number, step: number, length: number): number {
	if (current < 0) return step < 0 ? length - 1 : 0
	return (current + step + length) % length
}
