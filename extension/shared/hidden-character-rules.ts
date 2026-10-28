/**
 * The single source of truth for the characters this extension looks for.
 *
 * Adding a new kind of hidden character means adding one entry to `CHARACTER_RULES`:
 * everything else (scanning, counting, marking, the UI legend) reads from here.
 */

/**
 * How suspicious a group of characters is.
 *
 * `hidden`    - never needed in ordinary prose, so a hit is very likely deliberate
 * `ambiguous` - invisible, but legitimate in emoji, RTL or Indic text
 * `spacing`   - a look-alike space, only meaningful in large numbers
 */
export const severity = {
	hidden: 'hidden',
	ambiguous: 'ambiguous',
	spacing: 'spacing',
} as const

/** One of the severity groups a rule can belong to. */
export type Severity = (typeof severity)[keyof typeof severity]

/**
 * The severity groups in the order the report shows them: the findings that are
 * almost certainly deliberate first, the harmless ones last.
 *
 * Written out rather than derived from `severity`, because object key order is
 * an implementation detail and the report should not reorder itself if the
 * object is ever rewritten.
 */
export const severityOrder = [
	severity.hidden,
	severity.ambiguous,
	severity.spacing,
] as const satisfies readonly Severity[]

/** Display names for the severity groups, used by the popup. */
export const severityLabel: Record<Severity, string> = {
	[severity.hidden]: 'Invisible',
	[severity.ambiguous]: 'Often legitimate',
	[severity.spacing]: 'Space variant',
}

/** Whether an untrusted value, such as a `data-` attribute, names a severity group. */
export function isSeverity(value: unknown): value is Severity {
	return typeof value === 'string' && (severityOrder as readonly string[]).includes(value)
}

/** An inclusive pair of code points. */
export type CodePointRange = readonly [start: number, end: number]

/** One group of flagged code points, and how suspicious the group is. */
export interface HiddenCharacterRule {
	/** Stable identifier, used as the key in scan reports. */
	readonly id: string
	readonly label: string
	readonly severity: Severity
	/** Why these code points are interesting, shown in the popup legend. */
	readonly note: string
	readonly ranges: readonly CodePointRange[]
	/**
	 * Whether the character stands in for a space.
	 *
	 * A strip puts one of these back as an ordinary space instead of deleting it:
	 * the reader sees a space there, so removing it would run two words together.
	 * Zero-width characters and joiners leave this unset, because deleting those
	 * is exactly the point.
	 */
	readonly spaceSubstitute?: boolean
}

/**
 * Every rule this extension knows about. Each range is an inclusive pair of code
 * points, and the list doubles as the display order in the popup, so rules are
 * checked in the order they appear here.
 */
export const CHARACTER_RULES = [
	{
		id: 'unicode-tags',
		label: 'Unicode tag characters',
		severity: severity.hidden,
		note: 'The deprecated U+E0000–U+E007F tag block. A long run of tags after ordinary text is a classic place to smuggle a payload or an account fingerprint.',
		ranges: [[0xe0000, 0xe007f]],
	},
	{
		id: 'private-use',
		label: 'Private use characters',
		severity: severity.hidden,
		note: 'Code points that only mean something to a private agreement between a sender and a receiver. Nothing draws them, so they are the least visible way to embed data.',
		ranges: [
			[0xe000, 0xf8ff],
			[0xf0000, 0xffffd],
			[0x100000, 0x10fffd],
		],
	},
	{
		id: 'zero-width-space',
		label: 'Zero-width space',
		severity: severity.hidden,
		note: 'U+200B occupies no width. Alternating it with ordinary spaces encodes bits that survive copy and paste.',
		ranges: [[0x200b, 0x200b]],
	},
	{
		id: 'zero-width-joiner',
		label: 'Zero-width joiner and non-joiner',
		severity: severity.ambiguous,
		note: 'U+200C and U+200D are required in Persian, Indic scripts and emoji sequences, and also work as single-bit markers.',
		ranges: [[0x200c, 0x200d]],
	},
	{
		id: 'word-joiner',
		label: 'Word joiner and byte order mark',
		severity: severity.hidden,
		note: 'U+2060 and U+FEFF are separators that render as nothing at all.',
		ranges: [
			[0x2060, 0x2060],
			[0xfeff, 0xfeff],
		],
	},
	{
		id: 'invisible-operator',
		label: 'Invisible mathematical operators',
		severity: severity.hidden,
		note: 'U+2061–U+2064 carry meaning for typesetting software and are never drawn.',
		ranges: [[0x2061, 0x2064]],
	},
	{
		id: 'variation-selector',
		label: 'Variation selectors',
		severity: severity.ambiguous,
		note: 'U+FE00–U+FE0F and U+E0100–U+E01EF pick a glyph style. Emoji need them, but a selector after a plain letter is pure noise, and 256 of them are enough to hide a byte per character.',
		ranges: [
			[0xfe00, 0xfe0f],
			[0xe0100, 0xe01ef],
		],
	},
	{
		id: 'bidi-control',
		label: 'Bidirectional controls',
		severity: severity.ambiguous,
		note: 'Arabic letter mark, left/right marks and the embedding, override and isolate controls. Real mixed-direction text needs them; they also reorder text so that a reader cannot see what is written.',
		ranges: [
			[0x061c, 0x061c],
			[0x200e, 0x200f],
			[0x202a, 0x202e],
			[0x2066, 0x2069],
		],
	},
	{
		id: 'interlinear-annotation',
		label: 'Interlinear annotation',
		severity: severity.hidden,
		note: 'U+FFF9–U+FFFB label ruby-style annotations for specialised formatters. Browsers ignore them completely.',
		ranges: [[0xfff9, 0xfffb]],
	},
	{
		id: 'combining-grapheme-joiner',
		label: 'Combining grapheme joiner',
		severity: severity.hidden,
		note: 'U+034F keeps neighbouring characters in separate grapheme clusters and is invisible. It has no place in plain prose.',
		ranges: [[0x034f, 0x034f]],
	},
	{
		id: 'deprecated-format',
		label: 'Deprecated format characters',
		severity: severity.hidden,
		note: 'U+206A–U+206F and the Mongolian vowel separator U+180E were withdrawn from Unicode but still decode as invisible characters.',
		ranges: [
			[0x180e, 0x180e],
			[0x206a, 0x206f],
		],
	},
	{
		id: 'soft-hyphen',
		label: 'Soft hyphen',
		severity: severity.ambiguous,
		note: 'U+00AD is an invisible hyphenation hint. It is normal when text is copied out of HTML, and suspicious when it appears in a chat response.',
		ranges: [[0x00ad, 0x00ad]],
	},
	{
		id: 'space-look-alike',
		label: 'Look-alike spaces',
		severity: severity.spacing,
		note: 'No-break, thin, hair, narrow no-break and ideographic spaces all look like a normal space. Substituting some of them for others encodes bits while the paragraph still reads normally.',
		ranges: [
			[0x00a0, 0x00a0],
			[0x2000, 0x200a],
			[0x202f, 0x202f],
			[0x205f, 0x205f],
			[0x3000, 0x3000],
		],
		spaceSubstitute: true,
	},
	{
		id: 'blank-filler',
		label: 'Blank filler characters',
		severity: severity.spacing,
		note: 'Braille pattern blank U+2800 and the Hangul fillers U+3164 and U+FFA0 draw nothing at all but still take up a place in the text, so they are pasted in where a space should be.',
		ranges: [
			[0x2800, 0x2800],
			[0x3164, 0x3164],
			[0xffa0, 0xffa0],
		],
		spaceSubstitute: true,
	},
] as const satisfies readonly HiddenCharacterRule[]

/** One rule from the table, with its id and severity kept as literal types. */
export type CharacterRule = (typeof CHARACTER_RULES)[number]

/** The id of a rule in the table, for example `private-use`. */
export type RuleId = CharacterRule['id']

/**
 * Find the rule that covers a code point.
 *
 * The table is short and the ranges are few, so a straight scan beats building a
 * lookup map that would need hundreds of thousands of entries for the private
 * use areas.
 */
export function ruleForCodePoint(codePoint: number): CharacterRule | null {
	for (const rule of CHARACTER_RULES) {
		for (const [start, end] of rule.ranges) {
			if (codePoint >= start && codePoint <= end) return rule
		}
	}
	return null
}

/** Render a code point the way Unicode does, for example `U+E0001`. */
export function formatCodePoint(codePoint: number): string {
	return `U+${codePoint.toString(16).toUpperCase().padStart(4, '0')}`
}

/**
 * Whether a rule's characters stand in for a space.
 *
 * Takes the wide interface rather than the literal union of the table, so the
 * optional flag can be read without every rule having to spell it out.
 */
export function isSpaceSubstitute(rule: HiddenCharacterRule): boolean {
	return rule.spaceSubstitute === true
}
