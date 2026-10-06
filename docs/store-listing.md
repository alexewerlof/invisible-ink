# Chrome Web Store listing

Copy for the fields in the Chrome Developer Dashboard. Character limits are Chrome's, not
ours; the counts next to the two short fields are there so a future edit knows how much room
is left.

## Name

```
Invisible Ink — hidden character detector
```

43 characters (Chrome allows 75). The brand carries the unique part; the suffix carries the
search keywords that the crowded `hidden character` listings already compete for.

## Summary (short description)

```
Reveal, copy or remove hidden Unicode characters — zero-width spaces, tag characters, BOMs — hiding in text you copy.
```

117 characters (Chrome allows 132). Lead with the verbs a user would tap: reveal, copy, remove.

## Detailed description

```
Invisible Ink finds the characters you cannot see.

Copy a reply out of an AI chat, a PDF, a CMS or a spreadsheet and it can carry characters
that render as nothing at all — no width, no glyph, no trace on screen — but are still there
when the text is pasted somewhere else. They break searches, break diffs, break form
validation, and they can carry a hidden payload. Invisible Ink shows you exactly what is in
your text and lets you delete it.

WHAT IT FINDS

Invisible Ink reads the text of the page you are on and reports every character that is not
visible in the rendered text but survives copy and paste:

• Zero-width space (U+200B)
• Zero-width joiner and non-joiner (U+200C, U+200D)
• Word joiner and byte order mark (U+2060, U+FEFF)
• Unicode tag characters (U+E0000–U+E007F)
• Private use characters (U+E000–U+F8FF and the two supplementary areas)
• Invisible mathematical operators (U+2061–U+2064)
• Variation selectors (U+FE00–U+FE0F, U+E0100–U+E01EF)
• Bidirectional controls (U+061C, U+200E–U+200F, U+202A–U+202E, U+2066–U+2069)
• Interlinear annotation, combining grapheme joiner, deprecated format characters
• Soft hyphen (U+00AD)
• Look-alike spaces: no-break, thin, hair, narrow no-break and ideographic spaces
• Blank fillers used as invisible spaces: braille pattern blank (U+2800) and Hangul fillers
  (U+3164, U+FFA0)

Characters that are also legitimate — the joiner in an emoji sequence, the no-break space in
prose — are labelled "often legitimate" instead of "invisible", so the list does not cry wolf.

HOW IT WORKS

1. Open any page — a chat with an AI assistant, an article, a document viewer.
2. Click the toolbar button. The counter shows how many hidden characters the page contains,
   broken down by kind and by code point. Refresh in the popup header re-checks a page that
   changed after the popup opened.
3. Show replaces each one with a labelled marker, such as U+200B, directly in the page.
   Hover a marker to see the kind of character it is. Prev and Next step through the findings
   and scroll each into view.
4. Remove deletes them for good. Hide puts the originals back where they were. A character that
   stands in for a space — a no-break space, a braille pattern blank, a Hangul filler — is put
   back as an ordinary space rather than deleted, so removing it does not run two words
   together.
5. To clean up just one snippet, select it, right-click and choose Hidden characters → Copy
   clean text. The selection goes to your clipboard with the hidden characters stripped out,
   without opening the popup or changing the page.

The toolbar badge shows the count for the current tab at a glance and clears when you
navigate. A right-click menu offers the same reveal, restore and remove actions — plus Copy
clean text, which strips a selection straight to the clipboard — and works inside frames and
iframes that the toolbar panel does not count.

WHY IT MATTERS

Invisible characters are used for accidental noise and for deliberate signalling: text
watermarking that survives copy and paste, per-account fingerprints, and prompt-injection
payloads hidden in text a model will read. Whatever the reason, you should be able to see
what is actually in your text and decide what to keep.

AI watermarks are sometimes character-based and sometimes not. Invisible Ink handles the
character-based kind: if the marker is a code point, this extension finds it. Statistical
watermarks that live in the choice of words have nothing to remove from the text, and
Invisible Ink will not pretend otherwise.

PRIVACY

No network requests. No account. No analytics. No storage. Invisible Ink reads the text
nodes of the page you are on, and the popup renders a summary of what it found; that is the
entire data flow. Everything runs on your device, and closing the page undoes everything.

HONEST LIMITS

• It only sees characters. A watermark built into word choice has no character to remove.
• Whitespace schemes made of ordinary spaces are invisible to any rule table.
• Text in editable places is skipped: an input or textarea keeps its text in the field
  rather than on the page, and rewriting a contenteditable box would break the site, so a
  chat composer is left alone.
• Text inside a cross-origin iframe is not counted by the popup or the badge, though the
  right-click menu still works there.
• Copy clean text needs a page the extension is allowed to run on, so it does not work on
  browser-owned pages such as chrome:// settings, the Web Store or the built-in PDF viewer.
• Emoji use zero-width joiners and variation selectors, so those are flagged as "often
  legitimate" rather than "invisible".
• A site can re-render its text and put the characters back; clearing them is a page-local
  change, and a reload restores the page.

Invisible Ink is open source. It is a small, readable Manifest V3 extension, and the exact
list of characters it looks for lives in one file in the source.
```

## Category

Productivity. (Developer Tools is a reasonable second choice; Productivity matches the
"clean up text you copy" use case better.)

## Search keywords

Weave these into the description naturally in future edits; the store already matches on the
name and description, so there is no separate keyword field. Ordered by how likely a user is
to type them:

hidden characters, invisible characters, zero-width space, zero-width joiner, unicode
remover, remove invisible characters, byte order mark, BOM, soft hyphen, variation selector,
copy paste cleaner, AI watermark, text watermark, hidden text detector, unicode inspector.

## Single purpose statement

> Invisible Ink finds and removes hidden Unicode characters in the text of the page the user
> is viewing.

## Permission justifications

| Permission                     | Why it is needed                                                                                                                                                   |
| ------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `activeTab`                    | The popup inspects the page the user is looking at, and only after they click the toolbar button.                                                                  |
| `scripting`                    | Injects the detector into a tab whose page loaded before the extension did, so the first click still works, and writes the cleaned-up selection to the clipboard.  |
| `contextMenus`                 | Adds the right-click "Hidden characters" menu, including **Copy clean text**.                                                                                      |
| Content script on `<all_urls>` | The hidden characters can be on any site, so the detector has to be able to run wherever the user asks it to. It reads text nodes only and sends nothing anywhere. |

No host permissions beyond what the content script needs, and no `storage`, `tabs` or
`webRequest` permission.

## Data usage disclosure

Answer the dashboard's data-usage form as **collects nothing**:

- Does not collect or use personal communications, health, financial, authentication,
  personal, or location information.
- Does not collect or transmit web history or user activity.
- Does not use remote code, and makes no network requests at all.
- Data is not sold or transferred to third parties, and is not used for purposes unrelated
  to the single purpose above.

## Trademark note

The description deliberately says "AI chat", "AI assistant" and "AI tools" rather than naming
any provider. Naming a product in the listing invites a trademark complaint during review,
and the extension works on any site regardless of who wrote the text.
