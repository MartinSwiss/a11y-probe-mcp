# A11y Probe

Paid WCAG scans for AI agents. A Cloudflare Worker exposes an MCP server at `/mcp` and the same calls over HTTP. Callers pay per call with x402 (USDC on Base). Automated checks find roughly 57% of WCAG issues. A report is a template: not legal advice, no compliance guarantee.

Our code is MIT. The unmodified `axe-core` dependency is MPL-2.0 (see [NOTICE](NOTICE)). The product name does not use that dependency's name.

Nothing in this repository is deployed. [DEPLOY.md](DEPLOY.md) is the owner's checklist.

## Prices

Set in [`src/config.ts`](src/config.ts):

| Call | USD | Route |
| --- | ---: | --- |
| `get_pricing` | 0 | `GET /api/v1/pricing` |
| `scan_page` | 0.05 | `POST /api/v1/scan/page` |
| `scan_site` | 0.50 | `POST /api/v1/scan/site` |
| `report` | 1.00 | `POST /api/v1/report` |

The home page states the same numbers, how a 402 is paid, and the limits. Draft terms, privacy, and imprint are under `/legal`. Terms are under Swiss law and cap liability for a paid call at the amount paid for that call. The privacy notice names Cloudflare and Coinbase as processors in the United States.

## Demo

Against a local `npx wrangler dev` (see [DEPLOY.md](DEPLOY.md)) or the deployed origin `https://a11y.aiagentpay.cloud`:

```sh
ORIGIN=http://127.0.0.1:8787

curl -s "$ORIGIN/api/v1/pricing"

curl -s -D - -o /tmp/a11y-402.json -X POST "$ORIGIN/api/v1/scan/page" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/","authorized":true}'
```

The second call is **402** with a `payment-required` header when the URL is allowed. It does not settle. A client that understands x402 signs USDC on Base Sepolia (`eip155:84532` in the default config) and retries with `PAYMENT-SIGNATURE`. Settlement happens only after the scan succeeds.

Blocked cases never return 402:

- `authorized` is not `true`
- the URL is not public http(s) on port 80 or 443
- `robots.txt` disallows `A11yProbe/1.0` or `*`
- 10 paid calls in a minute for that payer or IP
- 50 pages today for that domain, or the global daily cap

Try the MCP endpoint with MCP Inspector:

```sh
npx @modelcontextprotocol/inspector
```

Connect to `$ORIGIN/mcp` over Streamable HTTP. `get_pricing` is free. Paid tools advertise their price and the x402 Bazaar schema.

A local stdio process for Glama proxies the paid tools. `get_pricing` runs without a network:

```sh
A11Y_PROBE_URL=https://a11y.aiagentpay.cloud node --experimental-strip-types src/stdio.ts
```

## Configuration

| Name | Where | Purpose |
| --- | --- | --- |
| `PAY_TO` | var | Public Base address that receives USDC. Set in `wrangler.jsonc` for testnet and production. Override with a `PAY_TO` secret to swap it, including for a Stripe crypto address, without a code change. |
| `X402_NETWORK` | var | `eip155:84532` (Base Sepolia) by default. `eip155:8453` in `env.production`. |
| `FACILITATOR_URL` | var | `https://x402.org/facilitator` for tests. CDP `https://api.cdp.coinbase.com/platform/v2/x402` in production. |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | secrets | CDP JWT auth for the mainnet facilitator. Required only under `env.production`. The testnet config does not list them. |
| `INFO_URL` | var | Public origin used in the user agent and legal links. `https://a11y.aiagentpay.cloud/` in both environments. |
| `GLOBAL_DAILY_PAGE_CAP` | var | Default 20, to stay inside Browser Run's free daily minutes. |

`server.json` publishes the server as `io.github.MartinSwiss/a11y-probe-mcp`. The remote URL is `https://a11y.aiagentpay.cloud/mcp`. Do not publish before the Worker answers.

## Develop

```sh
npm ci
npx wrangler types
npm test
npm run typecheck
```

Tests do not spend USDC. Payment tests use a local facilitator and a throwaway signing key.
