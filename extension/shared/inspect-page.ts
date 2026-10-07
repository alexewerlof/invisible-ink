/**
 * Where the paste-in inspector lives.
 *
 * Both the popup button and the right-click menu open the same extension page, so
 * its path is written down once instead of in two documents that could drift.
 */

/** The page's path inside the extension. */
export const inspectPagePath = 'inspect/inspect.html'

/** The page's absolute URL, which is what `chrome.tabs.create` wants. */
export function inspectPageUrl(): string {
	return chrome.runtime.getURL(inspectPagePath)
}
