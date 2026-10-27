# AGENTS.md

Guidance for agents working in this repository. See `README.md` for what the extension does
and how to use it.

## Commands

```sh
npm test           # vitest, covers everything in extension/shared
npm run test:watch # vitest in watch mode
npm run lint       # eslint, no rule overrides
npm run lint:fix   # eslint --fix
npm run typecheck  # tsc --noEmit
npm run build      # vite, writes the loadable extension to dist/
npm run deploy-check  # format, lint, types, tests, build, build checks, then release/*.zip
npm run format     # prettier --write .
npm run format:check
```

`extension/` holds the TypeScript sources and `npm run build` bundles them into `dist/`,
which is what Chrome loads. There is no runtime dependency and no Python: `vite` is a
build-time tool and its output is plain JavaScript.

`manifest.json` is copied rather than rewritten, so the paths in it name the _built_ files.
That is why it says `content/hidden-character-detector.js` while the source is
`content/hidden-character-detector.ts`, and why the bundles are emitted without hashes.

`.agents/skills/chrome-extension-mv3/` is the authoritative guide for MV3 work here
(service worker lifecycle, injection and execution worlds, messaging, UI surfaces,
compliance). Read the reference that covers your change before writing it, and run its
compliance pass before calling the change done.

## Layout

| Path                                         | Contents                                                                                    |
| -------------------------------------------- | ------------------------------------------------------------------------------------------- |
| `extension/shared/hidden-character-rules.ts` | The only place that defines which code points are hidden characters                         |
| `extension/shared/hidden-character-scan.ts`  | Pure text helpers: scan, split, count, strip, merge                                         |
| `extension/shared/hidden-character-mark.ts`  | The marker: its class names, the descriptor and element builders, and the mark index step   |
| `extension/shared/inspect-session.ts`        | `LocalInspection`: the popup's command vocabulary run over a string the caller owns         |
| `extension/shared/report-view.ts`            | The report panel's renderers, shared by the popup and the inspector                         |
| `extension/shared/message-contract.ts`       | Message type strings and payload types shared by all contexts                               |
| `extension/shared/tab-messaging.ts`          | Sending a command to a tab: injection as a fallback, browser-owned origins refused up front |
| `extension/shared/theme.ts`                  | The severity palette shared by the markers, popup and badge                                 |
| `extension/shared/dom.ts`                    | Element lookups that throw when the markup and the script disagree                          |
| `extension/shared/inspect-page.ts`           | The inspector page's path and URL, named in one place                                       |
| `extension/content/`                         | Page detector and marker CSS                                                                |
| `extension/background/`                      | Service worker: badge, right-click menu and clipboard                                       |
| `extension/popup/`                           | Toolbar panel                                                                               |
| `extension/inspect/`                         | Paste-in inspector: an extension page opened in its own tab                                 |
| `extension/icons/`                           | The Boxy SVG source `icon.svg` and the PNGs exported from it                                |
| `dist/`                                      | Build output: the unpacked extension Chrome loads                                           |
| `test/`                                      | Vitest tests for the shared helpers                                                         |
| `tools/`                                     | Build and verification scripts, not shipped to Chrome                                       |

## Invariants

- **One source of truth for detection.** Adding a kind of hidden character means adding one entry
  to `CHARACTER_RULES`. Never add a second range list somewhere else, and never hardcode a
  code point outside that table.
- **A space variant is restored, not deleted.** A rule marked `spaceSubstitute` (the look-alike
  spaces and the blank fillers) is put back as an ordinary space by `joinCleanSegments` and by the
  detector's Remove, because deleting it would run two words together. `joinTextSegments` stays the
  raw "text only" helper; the detector and `stripHiddenCharacters` use the clean join. The
  `test/hidden-character-scan.test.ts` rules-table test fails if a new `spacing` rule forgets the
  flag.
- **Keep the shared modules pure.** `hidden-character-scan.ts` must not touch the DOM or `chrome.*`,
  because it is the part that is unit tested from Node.
- **The content script is bundled into a single classic script.** Vite emits
  `content/hidden-character-detector.js` as an IIFE with the shared modules inlined, so the page
  fetches nothing. There is no `web_accessible_resources` entry and no bootstrap module: a
  classic content script cannot use `import`, and a bundler removes the reason to work
  around that. Do not add a second entry point for the page. Because the detector is both
  declared in the manifest and injected on demand, registering its listener is guarded by a
  `globalThis` flag, and that guard has to stay.
- **Types come from the modules.** There are no JSDoc typedefs. Payload shapes are exported
  types from `message-contract.ts`, together with the runtime guards
  (`isCommandRequest`, `isCommandResponse`, `isReportMessage`). `@types/chrome` types every
  message boundary as `any`, so narrow with those guards instead of a cast or a disable
  comment — the lint configuration treats an unsafe `any` as an error.
- **Every command answers with a fresh scan.** The popup renders only from the response it
  just received, so it never shows a stale count. Keep the `{ ok, changed, scan }` shape.
- **Navigation belongs to the page.** Show/Prev/Next send `focusFirst`/`focusPrevious`/
  `focusNext`, which reveal the page if it is still hidden and then scroll one marker into
  view, highlighted with the `ii-hidden-character--active` modifier and wrapped at either
  end. The detector owns the highlighted index, because the popup is rebuilt every time it
  opens, and reports it as `scan.focus` so the panel can say `3 / 21`.
- **The counter and the badge describe the main frame.** `requestInTab` defaults to
  `mainFrameId`, and the service worker ignores `messageType.report` from any other frame, so
  the two can never disagree. Never send a tab message without a frame id: it reaches every
  frame in the tab, the sender renders whichever frame answers first, and the badge ends up
  with whichever frame reported last — that is the bug this rule exists to prevent.
- **The service worker owns the badge.** The detector publishes `messageType.report` after
  each command; the popup and the service worker never set the badge themselves.
- **The clipboard write runs in the clicked frame.** A service worker has no DOM, and
  `navigator.clipboard` will not write from a document that cannot be focused, so the copy
  action takes the selection from `info.selectionText`, strips it with the shared helper and
  injects a self-contained write function into the frame the click happened in, through
  `runInFrame`. Taking the text from the click is what makes the copy work for a selection in
  a form field, where the detector never looks. Do not move the write into the worker (it has
  no clipboard) and do not reach for `document.execCommand`, which is deprecated.
- **Page classes are namespaced.** Anything injected into a page uses the `ii-` prefix and
  BEM naming (`ii-hidden-character--ambiguous`), styled from
  `content/hidden-character-marks.css`, which the manifest injects so page CSS cannot strip it.
- **One marker, two renderers.** `shared/hidden-character-mark.ts` owns the marker's class names,
  the `describeHiddenCharacter` descriptor and the element builders. The content script and the
  inspector both draw markers through it, so the marker's DOM has one definition, and
  `test/hidden-character-mark.test.ts` pins the descriptor's fields.
- **The inspector is a page, not a script.** `extension/inspect/` is an extension page opened by
  `chrome.tabs.create`, so it is not in the manifest, not in `web_accessible_resources`, never
  reports the badge and needs no host permission. It scans text with the shared helpers through
  `LocalInspection`, and it draws its third column with the popup's own `ii-panel` markup and
  `shared/report-view.ts`. Its stylesheet `@import`s `popup/popup.css` and
  `content/hidden-character-marks.css` rather than restating either, so the severity palette still
  has exactly two hand-written copies and `test/theme.test.ts` keeps passing. `tools/check-build.ts`
  names `inspect/inspect.html` explicitly, because the manifest never points at it and nothing else
  would notice if the build stopped writing it.
- **`CommandType` is spelled out, never derived.** `shared/message-contract.ts` lists the page
  commands in `commandTypes` and derives both the type and `knownCommands` from it. Deriving it with
  `Exclude<MessageType, 'report'>` instead would let a new non-command message — `takePendingText` —
  widen `CommandType` silently, and the detector's `Record<CommandType, handler>` table would accept
  the missing handler as valid code.
- **The pending selection is the worker's one piece of in-memory state.** A right-click on a
  selection puts the text in a module-level slot just before `chrome.tabs.create`, the inspector
  claims it once over the message channel, and a timeout drops it if nothing does. It is
  a deliberate exception to the rehydration rule — the slot has to outlive the click-to-load window — and
  it is why the text never goes in the page's URL. Do not persist it: the extension's privacy claim
  is that it stores nothing.
- **Icons are exported, not generated.** `extension/icons/icon.svg` is the source, drawn by
  hand in Boxy SVG, and `icon-16.png`, `icon-32.png`, `icon-48.png` and `icon-128.png` are
  its exports at the sizes the manifest names. There is no icon script and no drawing or
  encoding code: edit the SVG, re-export the PNGs and rebuild. `npm run check-build` keeps
  each PNG's dimensions honest against the manifest.
- **The severity palette lives in `shared/theme.ts`.** The marker stylesheet, the popup
  stylesheet and the toolbar badge all colour themselves by severity, and CSS cannot import
  TypeScript, so the two stylesheets spell the same values out by hand. Change a colour in
  `theme.ts` and update both stylesheets; `test/theme.test.ts` fails until they agree.
- **Never write raw invisible characters into source files.** Use escapes (`'\u200B'`,
  `'\u{E0001}'`). Zero-width characters are silently dropped by some tooling, which turned a
  test into a false pass once already. The tests cover exactly that mistake.
- **`dist/` is emptied, never deleted.** Chrome running as a Flatpak app receives the folder
  through the document portal, which records the directory itself rather than a path it can
  look up again, so a build that removes or renames `dist/` leaves the loaded extension
  pointing at a directory that no longer exists: Reload reports "File path cannot be resolved.
  Could not load manifest." and the folder has to be picked again. Vite's `emptyOutDir` deletes
  the entries inside the directory and keeps it, so `tools/build.ts` asks for that on the first
  entry point only (the four builds share the directory), and `npm run build` fails if the
  directory's identity changed. Do not build into a staging directory and rename it over
  `dist/`; that reintroduces the same failure.
- **`textContent`, never `innerHTML`,** for anything derived from a page.

## Testing

`npm test` covers the rules table (unique ids, ordered non-overlapping ranges, known
severities) and the text handling (astral code points counted once, removals that keep
ordinary text, round-tripping a split). Add a case to `test/hidden-character-scan.test.ts` whenever
you add a rule or change a helper.

`LocalInspection` runs purely on strings, so the inspector's whole command surface — scanning,
revealing, walking the findings with wrapping, and Remove's space substitution — is covered from
Node in `test/inspect-session.test.ts`. `test/hidden-character-mark.test.ts` covers the marker
descriptor and the index step; the element itself only exists in a document, so it is checked in the
browser pass below.

`npm run check-build` verifies the built extension instead of the sources: every path the
manifest points at exists, the manifest and `package.json` agree on the version, the icons
are PNGs of the declared size, no bundle uses `eval` or a remote URL, and the content script
came out as a classic script rather than a module.

The DOM and messaging layers are verified in a browser: run `npm run build`, load `dist/`
unpacked, open `test/fixtures/hidden-characters-page.html`, and use the popup and the right-click
menu. The fixture documents the count it should report.
