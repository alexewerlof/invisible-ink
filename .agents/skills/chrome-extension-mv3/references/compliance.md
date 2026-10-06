# Security, Permissions and Compliance

MV3 enforcement is mechanical: violations fail at install, at review, or at runtime. Check
these before considering a feature finished.

## Content Security Policy

MV3 bans remotely hosted code outright. Every line of JavaScript must ship inside the package.

- No CDN `<script src>` in extension pages.
- No `eval()`, `new Function()`, `setTimeout('string')`, or `import()` of a remote URL.
- No inline `<script>` in extension HTML.
- Bundled third-party libraries are fine; fetching them at runtime is not.

If a dependency needs a remote component, vendor it at build time. If the feature genuinely
needs page-origin dynamic code, it belongs in the page via `world: 'MAIN'` under the page's
own CSP — not in the extension.

## `web_accessible_resources`

Anything the page must load directly — an injected script, CSS, font, or image — has to be
declared. MV3 requires the declaration to name the domains or extension ids allowed to use it;
an unrestricted entry lets any site probe your extension's fingerprint.

```json
{
	"resources": ["content/page-hook.js"],
	"matches": ["https://example.com/*"]
}
```

Narrow `matches` to the origins that actually need the file, and prefer `use_dynamic_url` when
the resource id should not be guessable. Resources not exposed this way are unreachable from
the page, which is usually what you want — this repository needs no such entry at all,
because its content script is a self-contained bundle that the page never has to fetch.

## Principle of Least Privilege

Every permission in `permissions` is shown to the user at install and increases review
scrutiny. The test for each one: _is this needed before the user takes the first action that
requires it?_

If not, it belongs in `optional_permissions` and is requested at a moment where the user can
understand the prompt:

```js
const granted = await chrome.permissions.request({
	permissions: ['webNavigation'],
	origins: ['https://example.com/*'],
})
```

- `activeTab` beats a broad host permission for user-initiated work on the current page.
- Prefer `host_permissions` for specific origins over `<all_urls>`.
- `unlimitedStorage` changes the install prompt — justify it or avoid it.
- Remove any permission the code no longer calls.

## Reviewing a Change

- [ ] No remote code, `eval`, `new Function`, or inline scripts.
- [ ] Every resource the page loads is declared in `web_accessible_resources`, narrowly.
- [ ] `permissions` contains only what install-time behaviour requires; the rest is optional
      and requested in context.
- [ ] Host permissions are the narrowest set that works.
- [ ] No data leaves the browser beyond what the feature documents.
- [ ] Restricted origins (`chrome://`, the Web Store) are handled as expected failures, not
      crashes.
- [ ] The manifest version is 3 and `minimum_chrome_version` matches the newest API used
      (`sidePanel` → 114, `userScripts` → 120, `sidePanel.close` → 141).
