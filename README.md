<p align="center">
  <img src="extension/icons/icon-128.png" alt="The Invisible Ink icon: a dark U+ monogram on an amber rounded square" width="128" height="128">
</p>

# Invisible Ink — hidden character detector

A small Chrome extension (Manifest V3, TypeScript, built with Vite) that finds the invisible
Unicode characters that hide in text copied from AI chat and other tools, shows you exactly
which ones they are, and lets you delete them.

It is deliberately narrow: it looks for characters that are _not_ visible in the rendered
text but are still there when the text is copied. That covers private use characters, the
Unicode tag block, zero-width characters, invisible operators, variation selectors,
bidirectional controls and look-alike spaces.

## Installing it

1. Run `npm install` and `npm run build`. This bundles the TypeScript sources from
   `extension/` into `dist/`.
2. Open `chrome://extensions`.
3. Turn on **Developer mode**.
4. Choose **Load unpacked** and select the `dist/` directory of this repository.

## Using it

Open a chat with any provider, have a conversation, then click the toolbar button.

| Where            | What you get                                                                                              |
| ---------------- | --------------------------------------------------------------------------------------------------------- |
| Toolbar button   | A popup with the counter, the breakdown by kind of character, **Show** / **Remove**, and a refresh button |
| Toolbar badge    | The number of hidden characters in the main document, cleared when you navigate                           |
| Right-click menu | **Hidden characters** → reveal, restore, or remove, applied to the frame you clicked                      |
| Selected text    | **Hidden characters** → **Copy clean text** copies the selection with the hidden characters stripped      |

The counter and the badge always describe the **main document** of the tab, so the two can
never disagree. A message that names no frame reaches every frame at once, which is exactly
how the badge and the panel used to drift apart: the panel rendered whichever frame answered
first while the badge kept the number of whichever frame reported last.

**Show** replaces every hidden character with a marker labelled with its code point, for
example `U+200B` (red for characters that are never needed in prose, amber for ones that
also appear legitimately, blue for look-alike spaces). Hover a marker to see the kind of
character it is, such as `Unicode tag characters`. The hidden character is _swapped_ for
the marker rather than kept beside it, so **Hide** puts the originals back exactly where
they were, and **Remove** deletes them for good.

**Copy clean text** skips all of that. Select the passage you care about, right-click and choose
**Hidden characters** → **Copy clean text**: the selection goes to the clipboard with every hidden
character stripped out, and the page is left exactly as it was. It is the fast path when you want
the text rather than the report.

A character that stands in for a space — a no-break space, a braille pattern blank, a Hangul
filler — is put back as an ordinary space rather than deleted, because deleting it would run two
words together. Everything else, joiners and format controls included, is removed.

Every command answers with a fresh scan, so the counter always describes the page as it is
right now. Reloading the page also restores it — nothing is written anywhere.

The **refresh** button in the popup header asks for that fresh scan on demand, for a page
that changes after the popup opens: a chat response that streams in, a feed that loads more
rows, a single-page app that swaps the document without navigating.

## How detection works

Everything is driven by one table in
[`extension/shared/hidden-character-rules.ts`](extension/shared/hidden-character-rules.ts). Each entry
names an inclusive range of code points and how suspicious that range is:

| Kind                             | Code points                                         | Severity         |
| -------------------------------- | --------------------------------------------------- | ---------------- |
| Unicode tag characters           | U+E0000–U+E007F                                     | invisible        |
| Private use characters           | U+E000–U+F8FF, U+F0000–U+FFFFD, U+100000–U+10FFFD   | invisible        |
| Zero-width space                 | U+200B                                              | invisible        |
| Zero-width joiner / non-joiner   | U+200C–U+200D                                       | often legitimate |
| Word joiner, byte order mark     | U+2060, U+FEFF                                      | invisible        |
| Invisible mathematical operators | U+2061–U+2064                                       | invisible        |
| Variation selectors              | U+FE00–U+FE0F, U+E0100–U+E01EF                      | often legitimate |
| Bidirectional controls           | U+061C, U+200E–U+200F, U+202A–U+202E, U+2066–U+2069 | often legitimate |
| Interlinear annotation           | U+FFF9–U+FFFB                                       | invisible        |
| Combining grapheme joiner        | U+034F                                              | invisible        |
| Deprecated format characters     | U+180E, U+206A–U+206F                               | invisible        |
| Soft hyphen                      | U+00AD                                              | often legitimate |
| Look-alike spaces                | U+00A0, U+2000–U+200A, U+202F, U+205F, U+3000       | space variant    |
| Blank fillers                    | U+2800, U+3164, U+FFA0                              | space variant    |

Adding a new scheme is a single entry in that table; the scanner, the counter, the markers
and the popup legend all read from it.

### The private use pairs

A response like

```
Treats workflows as directed graphs.␁␉ Features include human-in-the-loop (HITL) pause/resume, …
```

that reports `U+E001, U+E801, U+E002, U+E802, U+E003, U+E803` is worth looking at closely:
the two ranges interleave as the low and high halves of a 16-bit value
(`0xE801 - 0xE800 << 8 | 0xE001 - 0xE000` gives `0x0101`, `0x0202`, `0x0303`). Two private
use areas used in lockstep like that is a byte-packing scheme, not accidental font noise.
The tests in [`test/hidden-character-scan.test.ts`](test/hidden-character-scan.test.ts) use
exactly that payload.

## What it cannot do

Be honest about the ceiling here: these characters are sometimes called AI watermarks, but
most watermarking is not something you can delete from the text.

- **It only sees characters.** Statistical and semantic watermarks are baked into the
  _choice_ of words by the model. There is no character to remove and this extension will
  never find them.
- **Whitespace schemes made of ordinary spaces** (an extra space after every 40th word) are
  invisible to any rule table, because the characters themselves are unremarkable.
- **Server-side watermarks** — provider logs, request signing, response hashes — are not in
  the text at all.
- **It skips text in editable places.** A `<textarea>` or `<input>` keeps its text in the
  element's `value` rather than in the document, so the text-node walker never sees it (the
  decoder text box on a site like `invisible-characters.com` is exactly this). A
  `contenteditable` region does hold text nodes, but rewriting them would break the editor
  state of the site, so it is skipped too. In short: the text you are typing into is not the
  text that gets scanned — put it on the page itself to inspect it. **Copy clean text** is the
  exception: it takes the selection the browser reports, so it works in a form field too.
- **Text inside a cross-origin iframe** is not counted by the popup or the badge, because
  both describe the main document. The right-click menu still works there: it acts on the
  frame you clicked and injects the detector into it when needed. **Copy clean text** writes
  from that frame too, because the browser hands it the selection directly.
- **Browser-owned pages** (`chrome://`, the Web Store, the built-in PDF viewer) cannot host
  the detector or the injected clipboard write, so **Copy clean text** does not work there.
- **`UI + emoji` are flagged.** Zero-width joiners and variation selectors are required by
  emoji sequences, which is why they are marked "often legitimate" instead of "invisible".
- **A site can re-render the text** and put the characters back, and clearing them is a
  page-local change: reload and they return.

## Privacy

No network requests, no storage, no analytics. The content script reads the text nodes of
the page you are on, and the popup renders a summary of them. The one thing that ever leaves
the extension is the cleaned-up text you explicitly ask it to copy, and that goes only to your
own clipboard. That is the entire data flow.

## Repository layout

```
extension/                  the sources: manifest plus TypeScript for each context
  manifest.json             copied into dist/ unchanged, so it names the built files
  background/               service worker: toolbar badge, right-click menu and clipboard
  content/                  page detector plus the CSS for its markers
  popup/                    the panel behind the toolbar button
  shared/                   rules, scanning helpers and the message contract
  icons/                    icon.svg (the Boxy SVG source) with the PNGs exported from it
dist/                       build output: the unpacked extension Chrome loads
test/                       unit tests for the scanning helpers, and a browser fixture
tools/                      build and verification scripts
```

The toolbar icon is drawn by hand in [Boxy SVG](https://boxy-svg.com).
`extension/icons/icon.svg` is the source, and `icon-16.png`, `icon-32.png`, `icon-48.png`
and `icon-128.png` are its exports at the four sizes the manifest names. Nothing draws or
converts them at build time: edit the SVG, re-export the PNGs, and the next build bundles
them.

## Development

Node 22.12 or newer. Vite is the only build tool; there is no runtime dependency, and the
shipped JavaScript is plain, readable output rather than minified.

```sh
npm test           # vitest: scanning rules and text handling
npm run lint       # eslint, type-aware, no rule overrides
npm run typecheck  # tsc --noEmit
npm run build      # bundle extension/ into dist/
npm run watch      # rebuild on change (reload the extension afterwards)
npm run format     # prettier
npm run check-build   # verify dist/: manifest paths, icon sizes, no eval, classic content script
npm run package       # build, then write release/invisible-ink-<version>.zip
npm run deploy-check  # every check above, in order, ending with the zip
```

To check a change by hand: run `npm run build`, load `dist/` unpacked, open
`test/fixtures/hidden-characters-page.html` over `file://` (enable _Allow access to file URLs_ for
the extension), click the toolbar button, and try Show, Refresh, Hide and Remove. The page carries
the private use pairs, tag characters, zero-width characters, variation selectors, look-alike
spaces and ordinary prose for contrast, and it documents the count a scan should report.
