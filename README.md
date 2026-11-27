# A11y Probe

[![A11y Probe MCP server](https://glama.ai/mcp/servers/MartinSwiss/a11y-probe-mcp/badge)](https://glama.ai/mcp/servers/MartinSwiss/a11y-probe-mcp)

Paid WCAG scans for AI agents. Production runs at [https://a11y.aiagentpay.cloud](https://a11y.aiagentpay.cloud). The MCP server is [https://a11y.aiagentpay.cloud/mcp](https://a11y.aiagentpay.cloud/mcp). Callers pay per call with x402 in USDC on Base mainnet (`eip155:8453`). The same calls are available over HTTP. Automated checks find roughly 57% of WCAG issues. A report is a template: not legal advice, no compliance guarantee.

Our code is MIT. The unmodified `axe-core` dependency is MPL-2.0 (see [NOTICE](NOTICE)). The product name does not use that dependency's name.

The top-level Wrangler config is Base Sepolia (`eip155:84532`) and is what `wrangler dev` uses. [DEPLOY.md](DEPLOY.md) is the owner's checklist.

## Prices

Set in [`src/config.ts`](src/config.ts):

| Call | USD | Route |
| --- | ---: | --- |
| `get_pricing` | 0 | `GET /api/v1/pricing` |
| `check_contrast` | 0.01 | `POST /api/v1/check/contrast` |
| `scan_page` | 0.05 | `POST /api/v1/scan/page` |
| `check_links_meta` | 0.05 | `POST /api/v1/check/links-meta` |
| `scan_site` | 0.50 | `POST /api/v1/scan/site` |
| `report` | 1.00 | `POST /api/v1/report` |

The home page states the same numbers, how a 402 is paid, and the limits. Draft terms, privacy, and imprint are under `/legal`. Terms are under Swiss law and cap liability for a paid call at the amount paid for that call. The privacy notice names Cloudflare and Coinbase as processors in the United States.

## Demo

Local `npx wrangler dev` (see [DEPLOY.md](DEPLOY.md)) uses the default config, Base Sepolia (`eip155:84532`). The live origin `https://a11y.aiagentpay.cloud` is Base mainnet (`eip155:8453`).

```sh
# Local testnet. For production, set ORIGIN=https://a11y.aiagentpay.cloud
ORIGIN=http://127.0.0.1:8787

curl -s "$ORIGIN/api/v1/pricing"

curl -s -D - -o /tmp/a11y-402.json -X POST "$ORIGIN/api/v1/scan/page" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/","authorized":true}'
```

The second call is **402** with a `payment-required` header when the URL is allowed. It does not settle. Against local dev, a client that understands x402 signs USDC on Base Sepolia (`eip155:84532`) and retries with `PAYMENT-SIGNATURE`. Against production, the same header is a Base mainnet (`eip155:8453`) USDC payment. Settlement happens only after the scan succeeds.

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

## Stripe Machine Payments (optional, off by default)

This is off unless `STRIPE_MACHINE_PAYMENTS` is the exact string `true`. While it is off, paid calls stay on the current x402 flow: the CDP facilitator, the existing `PAY_TO` address, and the same 402 body.

Turning it on needs a Stripe account and machine payments access. Card payments through Shared Payment Tokens are available to US businesses. Stablecoin payments are available in US states except New York. Sellers outside the US request access by emailing machine-payments@stripe.com with their Stripe account ID. Use a Stripe test-mode key (`sk_test_...`) and a sandbox deposit address before any live key.

Setup, test mode first:

1. In the Stripe Dashboard, request the Stablecoins and Crypto payment method. Create a Stripe profile and note its `profile_` id (sandbox profiles use `profile_test_`).
2. Create a Base deposit address off the request path. The Stripe API version in the x402 guide is `2026-05-27.preview`. The sandbox deposit-address example uses `2026-07-29.preview`.

```sh
curl https://api.stripe.com/v1/crypto/deposit_addresses \
  -u "$STRIPE_SECRET_KEY:" \
  -H "Stripe-Version: 2026-07-29.preview" \
  -d network=base
```

3. Store the secrets. They are not in `wrangler.jsonc`.

```sh
printf 'true' | npx wrangler secret put STRIPE_MACHINE_PAYMENTS --env=""
npx wrangler secret put STRIPE_SECRET_KEY --env=""
npx wrangler secret put STRIPE_DEPOSIT_ADDRESS --env=""
npx wrangler secret put STRIPE_PROFILE_ID --env=""
```

Repeat with `--env production` only when you mean to take live USDC and cards. Do not commit the values.

When the flag is on, the 402 lists the existing CDP/Base option first and a second exact-scheme option paid to `STRIPE_DEPOSIT_ADDRESS`. After that option settles, the worker records a Stripe PaymentIntent in `transaction_verification` mode. Tools priced at 0.50 USD or more (`scan_site`, `report`) also send an MPP `WWW-Authenticate: Payment method="stripe"` challenge for a card Shared Payment Token. Cheaper tools do not. A failed SPT confirmation does not run the scan.

## Develop

```sh
npm ci
npx wrangler types
npm test
npm run typecheck
```

Tests do not spend USDC. Payment tests use a local facilitator and a throwaway signing key.
