/**
 * The severity palette, in one place.
 *
 * The markers injected into a page, the popup and the toolbar badge all colour
 * themselves by severity. None of them can read the others: the popup and the
 * badge run in different documents, and `content/hidden-character-marks.css` is
 * copied into the build byte for byte, so it cannot import anything. That left the
 * same hex values written out by hand in three files.
 *
 * This module is the authored copy. The two stylesheets still spell the values
 * out themselves, because CSS cannot import TypeScript, and `test/theme.test.ts`
 * fails when one of them stops matching. Change a colour here, change it in both
 * stylesheets, and run `npm test`.
 */

import { severity, type Severity } from './hidden-character-rules'

/** The two colours one severity needs: the text colour and its translucent wash. */
export interface SeveritySwatch {
	/** The marker or legend text, and the badge background. */
	readonly text: string
	/** The same colour at low alpha, drawn behind a marker. */
	readonly wash: string
}

/** What one severity looks like in a colour scheme. */
export interface SeverityTheme {
	readonly light: SeveritySwatch
	readonly dark: SeveritySwatch
}

/**
 * Every severity the scanner reports, in both colour schemes.
 *
 * Keyed by the `Severity` union from `hidden-character-rules.ts`, so a new
 * severity cannot be added without picking a colour for it here.
 */
export const severityTheme: Record<Severity, SeverityTheme> = {
	[severity.hidden]: {
		light: { text: '#b3261e', wash: 'rgb(179 38 30 / 14%)' },
		dark: { text: '#ffb4ab', wash: 'rgb(255 180 171 / 20%)' },
	},
	[severity.ambiguous]: {
		light: { text: '#8a5a00', wash: 'rgb(138 90 0 / 16%)' },
		dark: { text: '#f5c451', wash: 'rgb(245 196 81 / 20%)' },
	},
	[severity.spacing]: {
		light: { text: '#1a5fb4', wash: 'rgb(26 95 180 / 16%)' },
		dark: { text: '#9ec5ff', wash: 'rgb(158 197 255 / 20%)' },
	},
}

/**
 * The toolbar badge's background.
 *
 * The badge is drawn in whatever scheme the browser toolbar uses, and the action
 * API has no theme-aware variant, so it names one swatch directly rather than
 * holding a colour of its own. It is the ambiguous colour, because a finding is
 * more often arguably legitimate than plainly hidden.
 */
export const badgeBackgroundColor = severityTheme[severity.ambiguous].light.text
