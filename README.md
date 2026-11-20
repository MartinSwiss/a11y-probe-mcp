# A11y Probe

Paid WCAG accessibility scans for AI agents. Automated checks find roughly 57% of WCAG issues.

This repository starts with the scan engine: URL checks, `robots.txt`, a Browser Run loader, and the rule engine that turns a page into a violation list. The MCP server, x402 payments, and the public site land in follow-up pull requests. Nothing here is deployed.

## What a scan returns

A page result counts violations by impact and lists each rule with its WCAG tags, help link, node count, up to three selectors, and an HTML snippet cut at 200 characters. A site scan stays on the start origin, stops at 10 pages, and aggregates the same rules. Reports are filled-in Markdown templates in German, French, or English. They are not legal advice and they are not a compliance guarantee.

Prices live in [`src/config.ts`](src/config.ts):

| Call | USD |
| --- | ---: |
| `get_pricing` | 0 |
| `scan_page` | 0.05 |
| `scan_site` | 0.50 |
| `report` | 1.00 |

## Safety

Only `http` and `https` on ports 80 and 443 are fetched. IP literals, loopback, link-local, private, and metadata hosts are rejected, including after each redirect (five hops maximum). Hostnames are resolved before the fetch and rejected when any answer is non-public. `robots.txt` is read for `A11yProbe/1.0` and for `*`. A disallowed URL is refused before any document fetch. The caller must set `authorized` to `true`. The engine does not log in, send cookies, or submit forms.

The Browser Run loader is [`src/scan/browser.ts`](src/scan/browser.ts). Wrangler sets `keep_names` to `false` because the rule engine builds its injectable source with `Function#toString()`, and esbuild's name helper throws when that string runs in the page.

The rule engine dependency is unmodified `axe-core` (MPL-2.0). See [NOTICE](NOTICE). Our code is MIT.

## Develop

```sh
npm ci
npx wrangler types
npm test
npm run typecheck
```

## Worker

`POST /mcp` is a stateless MCP server (Streamable HTTP). The same tools are on `GET /api/v1/pricing` and `POST /api/v1/scan/page`, `/api/v1/scan/site`, and `/api/v1/report`.

Paid calls use x402 (USDC). The default Worker config is Base Sepolia (`eip155:84532`, facilitator `https://x402.org/facilitator`). The `production` environment is Base mainnet (`eip155:8453`) and the Coinbase CDP facilitator, which needs `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`. `PAY_TO` is the deposit address and is read from the environment, so it can later be swapped for a Stripe crypto address without a code change.

A scan that fails the SSRF check, `robots.txt`, the 10 calls/minute limiter, or a daily page cap is rejected before a 402. The facilitator settles only after the scan succeeds. Logs contain the timestamp, tool, price, transaction hash, payer address, and SHA-256 of the domain.

```sh
cp .dev.vars.example .dev.vars
# set PAY_TO, then:
npx wrangler dev
```

Do not put real keys or a funded address in the repo. Nothing in this repository is deployed.
