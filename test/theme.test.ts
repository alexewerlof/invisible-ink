/**
 * The severity palette is authored in `shared/theme.ts` and then written out again
 * by hand in two stylesheets, because CSS cannot import TypeScript and the marker
 * stylesheet is copied into the build unchanged. Nothing links the three copies,
 * so this test does: change a colour in one file and it fails until the others
 * catch up.
 */

import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

import { severity, type Severity } from '../extension/shared/hidden-character-rules'
import { badgeBackgroundColor, severityTheme, type SeveritySwatch } from '../extension/shared/theme'

const extensionDirectory = join(dirname(fileURLToPath(import.meta.url)), '..', 'extension')

function readStylesheet(relativePath: string): string {
	// Comments name the classes too, so a stray mention inside one must not read as
	// a rule by the time the block matchers below look at the text.
	return readFileSync(join(extensionDirectory, relativePath), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
}

function escapeRegExp(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** The declaration block of every rule whose selector is exactly this string. */
function declarationBlocks(source: string, selector: string): string[] {
	const pattern = new RegExp(`${escapeRegExp(selector)}\\s*\\{([^}]*)\\}`, 'g')
	return [...source.matchAll(pattern)].map((match) => match[1] ?? '')
}

/** One property's value inside a declaration block, trimmed. */
function declaration(block: string, property: string): string {
	const pattern = new RegExp(`(?:^|;)\\s*${escapeRegExp(property)}:\\s*([^;]+);`)
	return (pattern.exec(block)?.[1] ?? '').trim()
}

/** A custom property's values, one per declaration, in file order. */
function customProperty(source: string, name: string): string[] {
	const pattern = new RegExp(`--${escapeRegExp(name)}:\\s*([^;]+);`, 'g')
	return [...source.matchAll(pattern)].map((match) => (match[1] ?? '').trim())
}

/** The swatches a marker rule declares, one per colour scheme, in file order. */
function markerSwatches(source: string, selector: string): SeveritySwatch[] {
	return declarationBlocks(source, selector).map((block) => ({
		text: declaration(block, 'color'),
		wash: declaration(block, 'background-color'),
	}))
}

/** Each entry names the severity variable, then the palette key it must equal. */
const paletteEntries: readonly (readonly [string, Severity])[] = [
	['hidden', severity.hidden],
	['ambiguous', severity.ambiguous],
	['spacing', severity.spacing],
]

describe('the popup palette', () => {
	const source = readStylesheet('popup/popup.css')

	// The light block is written before the dark one, so the two declarations line
	// up with `SeverityTheme` without the test having to parse the media query.
	for (const [name, key] of paletteEntries) {
		it(`declares --${name} the way theme.ts says`, () => {
			expect(customProperty(source, name)).toEqual([severityTheme[key].light.text, severityTheme[key].dark.text])
		})
	}
})

describe('the marker palette', () => {
	const source = readStylesheet('content/hidden-character-marks.css')

	// The base marker rule carries the `hidden` severity; the modifiers carry the
	// other two, matching how the detector builds the class name.
	const markerSelectors: readonly (readonly [string, Severity])[] = [
		['.ii-hidden-character', severity.hidden],
		['.ii-hidden-character--ambiguous', severity.ambiguous],
		['.ii-hidden-character--spacing', severity.spacing],
	]

	for (const [selector, key] of markerSelectors) {
		it(`colours ${selector} the way theme.ts says`, () => {
			expect(markerSwatches(source, selector)).toEqual([severityTheme[key].light, severityTheme[key].dark])
		})
	}
})

describe('the badge colour', () => {
	it('is the ambiguous light swatch theme.ts exposes', () => {
		expect(badgeBackgroundColor).toBe(severityTheme[severity.ambiguous].light.text)
	})
})
