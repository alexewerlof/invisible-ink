/**
 * The marker is the one piece of shared DOM between the page detector and the
 * paste-in inspector, so what it *means* is pinned here without a browser: the
 * descriptor is plain data, and the index step is pure arithmetic. The element
 * itself is only built in a document, so it is covered in the browser pass.
 */

import { describe, expect, it } from 'vitest'

import { describeHiddenCharacter, markBlock, nextMarkIndex } from '../extension/shared/hidden-character-mark'
import { severity } from '../extension/shared/hidden-character-rules'
import {
	segmentKind,
	splitTextByHiddenCharacters,
	type HiddenCharacterSegment,
} from '../extension/shared/hidden-character-scan'

/** The first hidden-character segment of a string, which is what a marker describes. */
function hiddenSegment(text: string): HiddenCharacterSegment {
	const segment = splitTextByHiddenCharacters(text).find(
		(candidate): candidate is HiddenCharacterSegment => candidate.kind === segmentKind.hiddenCharacter,
	)

	if (segment === undefined) throw new Error(`${JSON.stringify(text)} holds no hidden character to describe`)
	return segment
}

describe('describeHiddenCharacter', () => {
	it('names the code point, the rule and the severity class', () => {
		expect(describeHiddenCharacter(hiddenSegment('a\u200Bb'))).toEqual({
			className: `${markBlock} ${markBlock}--${severity.hidden}`,
			label: 'U+200B',
			title: 'Zero-width space',
			ariaLabel: 'Hidden character U+200B',
			value: '\u200B',
			codePoint: 0x200b,
		})
	})

	it('carries the severity of the rule it matched', () => {
		// U+200D is the zero-width joiner, which is "often legitimate" rather than invisible.
		const descriptor = describeHiddenCharacter(hiddenSegment('a\u200Db'))
		expect(descriptor.className).toBe(`${markBlock} ${markBlock}--${severity.ambiguous}`)
	})

	it('keeps the original character so a marker can be put back', () => {
		const descriptor = describeHiddenCharacter(hiddenSegment('a\u00A0b'))
		expect(descriptor.value).toBe('\u00A0')
	})

	it('labels an astral code point the way Unicode does', () => {
		const descriptor = describeHiddenCharacter(hiddenSegment('a\u{E0001}b'))
		expect(descriptor.label).toBe('U+E0001')
		expect(descriptor.codePoint).toBe(0xe0001)
	})
})

describe('nextMarkIndex', () => {
	it('starts at the first finding when nothing is highlighted', () => {
		expect(nextMarkIndex(-1, 1, 5)).toBe(0)
	})

	it('starts at the last finding when stepping back from nothing', () => {
		expect(nextMarkIndex(-1, -1, 5)).toBe(4)
	})

	it('walks forward and back', () => {
		expect(nextMarkIndex(0, 1, 5)).toBe(1)
		expect(nextMarkIndex(3, -1, 5)).toBe(2)
	})

	it('wraps around at both ends, so repeated clicks cycle', () => {
		expect(nextMarkIndex(4, 1, 5)).toBe(0)
		expect(nextMarkIndex(0, -1, 5)).toBe(4)
	})
})
