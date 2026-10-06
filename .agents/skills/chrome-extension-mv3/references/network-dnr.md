# Declarative Net Request

MV3 removes blocking `webRequest`. In its place, `chrome.declarativeNetRequest` (DNR) hands
the browser a set of declarative rules, which it evaluates natively. The extension never sees
the traffic — that is the point, and it is also the constraint: **rules are data, not code.**
If a decision needs runtime logic, you cannot express it as a DNR rule.

## Ruleset Tiers

| Tier    | How it is stored                                 | Limit                                | Use for                                  |
| ------- | ------------------------------------------------ | ------------------------------------ | ---------------------------------------- |
| Static  | `rule_resources` in `manifest.json`              | Large (up to 300,000 rules globally) | Shipping a fixed blocklist               |
| Dynamic | `updateDynamicRules()`, persisted by the browser | 30,000                               | User-defined or API-driven rules         |
| Session | `updateSessionRules()`, memory only              | 5,000                                | Ephemeral interventions for this session |

Static rules cannot be edited at runtime — only enabled or disabled:

```js
await chrome.declarativeNetRequest.updateEnabledRulesets({
	enableRulesetIds: ['blocklist'],
	disableRulesetIds: ['legacy'],
})
```

Dynamic rules must be replaced atomically by id. Read the existing ids, remove what you own,
add the new set — never blind-append on every worker wake, or you will hit the cap:

```js
const existing = await chrome.declarativeNetRequest.getDynamicRules()
const removeRuleIds = existing.map((rule) => rule.id)

await chrome.declarativeNetRequest.updateDynamicRules({
	removeRuleIds,
	addRules: buildRules(),
})
```

## A Rule

```json
{
	"id": 1,
	"priority": 1,
	"action": { "type": "block" },
	"condition": {
		"urlFilter": "||example.com/tracker",
		"resourceTypes": ["script", "xmlhttprequest"]
	}
}
```

## Header Modification Constraints

Editing request or response headers adds precedence rules that are easy to get wrong.

- Requires `"declarativeNetRequest"` **and** `"declarativeNetRequestWithHostAccess"`, plus host
  permissions for the affected URLs.
- Higher priority wins. A lower-priority rule **can only append** to a header a higher-priority
  rule already set — it cannot overwrite it.
- If a higher-priority rule removes a header, lower-priority rules cannot touch that header at
  all. Removal is final.
- Rules apply to `fetch()` made by the extension's service worker, but **not** to responses the
  worker constructs itself or to responses served from `CacheStorage`.

Design rule sets with the priority ordering explicit, and document which rule owns each header.

## Checklist

- [ ] The feature genuinely does not need to inspect traffic contents.
- [ ] Dynamic rules are replaced by id rather than appended.
- [ ] Priorities are deliberate, and header ownership is unambiguous.
- [ ] `declarativeNetRequestWithHostAccess` is declared only if headers are modified.
- [ ] Rule counts stay comfortably under the tier cap.
