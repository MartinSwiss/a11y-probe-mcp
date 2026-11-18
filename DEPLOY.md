# Deploy A11y Probe

The owner does these steps. This repository does not deploy, publish, sign up, or spend funds.

Do this on a Cloudflare Workers Free account. Keep `keep_names` set to `false` in `wrangler.jsonc`. The rule engine source breaks in the page if that flag flips back to true.

## 1. Tooling

```sh
git clone https://github.com/MartinSwiss/a11y-probe-mcp.git
cd a11y-probe-mcp
npm ci
npx wrangler login
```

`wrangler login` opens a browser for the Cloudflare account that will own the Worker. Do not paste an API token into chat.

## 2. Counters

Daily page caps use one KV namespace. Create it and paste the id into **both** `kv_namespaces` blocks in `wrangler.jsonc` (top level and `env.production`). The placeholder id is not a real namespace.

```sh
npx wrangler kv namespace create CAPS
```

The rate limiter binding (`RATE_LIMITER`, namespace id `1001`, 10 requests per 60 seconds) and the Browser Run binding (`BROWSER`) are declared in the config. They are created with the Worker. No separate purchase.

## 3. Secrets

Secrets are not in git. `PAY_TO` is the address that receives USDC. It can later be replaced with a Stripe crypto deposit address without a code change.

Testnet (default environment, Base Sepolia `eip155:84532`):

```sh
npx wrangler secret put PAY_TO --env=""
```

Use a testnet address. For the CDP keys on testnet, put any non-empty placeholder if `wrangler dev` warns that the required secrets are missing. The testnet facilitator `https://x402.org/facilitator` does not use them.

```sh
printf 'dev' | npx wrangler secret put CDP_API_KEY_ID --env=""
printf 'dev' | npx wrangler secret put CDP_API_KEY_SECRET --env=""
```

Mainnet, only when you are ready to go live (target Monday 30 November 2026). Create a CDP API key at the Coinbase Developer Platform first. Do not commit the values.

```sh
npx wrangler secret put PAY_TO --env production
npx wrangler secret put CDP_API_KEY_ID --env production
npx wrangler secret put CDP_API_KEY_SECRET --env production
```

`env.production` uses `eip155:8453` and `https://api.cdp.coinbase.com/platform/v2/x402`.

## 4. Public info URL

Edit `INFO_URL` in `wrangler.jsonc` (both environments) to the origin you will actually serve, for example `https://a11y-probe-mcp.<account-subdomain>.workers.dev`. That value is the user-agent contact URL and the base for the terms and privacy links. Deploy again after you change it.

## 5. Deploy testnet

```sh
npx wrangler deploy --env=""
```

`--env=""` is the top-level testnet config. A bare `wrangler deploy` warns when named environments exist.

Note the `*.workers.dev` hostname. Then:

```sh
curl -s "$ORIGIN/api/v1/pricing"
curl -s -D - -o /dev/null -X POST "$ORIGIN/api/v1/scan/page" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/","authorized":true}'
```

The scan request should be **402** with a `payment-required` header, not a charge. Confirm `/`, `/legal/terms`, `/legal/privacy`, and `/legal/imprint` load, and replace the imprint placeholders before you tell anyone the site is public.

Optional local check before deploy:

```sh
cp .dev.vars.example .dev.vars
# fill PAY_TO and the two CDP placeholders
npx wrangler dev --env=""
```

## 6. MCP Inspector

```sh
npx @modelcontextprotocol/inspector
```

Connect it to `https://<your-worker>/mcp` with Streamable HTTP. `get_pricing` is free. A paid tool returns an x402 payment error until the client pays. Do not point the inspector at a mainnet worker with a funded wallet unless you mean to spend USDC.

## 7. Registry and Glama

`server.json` is the official MCP registry manifest. The name is `io.github.MartinSwiss/a11y-probe-mcp`. The remote URL is `https://{host}/mcp`. Before `mcp-publisher publish`, set `host` to the deployed hostname (or replace the template with the concrete URL). Publishing is a separate step. Do it only after the testnet deploy answers.

Glama can launch the stdio entry, which proxies paid calls to the Worker:

```json
{
  "mcpServers": {
    "a11y-probe": {
      "command": "node",
      "args": ["--experimental-strip-types", "src/stdio.ts"],
      "env": { "A11Y_PROBE_URL": "https://<your-worker>" }
    }
  }
}
```

`get_pricing` works without `A11Y_PROBE_URL`. Paid tools do not.

## 8. Mainnet

When testnet scans and settlements look right:

1. Put the real `PAY_TO` and CDP secrets into `--env production` (step 3).
2. Set production `INFO_URL` to the public origin.
3. `npx wrangler deploy --env production`
4. Repeat the curl checks. A 402 is still not a charge. The first settled call spends test-or-real USDC on Base, so use an amount you accept (0.05 USDC for one page).

Workers Free includes Browser Run's free daily minutes. The global page cap defaults to 20 so a day of scans stays inside that allowance. Raise `GLOBAL_DAILY_PAGE_CAP` only if you accept Browser Run charges.

## Rollback

`npx wrangler rollback` restores the previous Worker version. It does not restore KV counters or secrets. To stop charges immediately, `npx wrangler secret put PAY_TO` with an address you control and redeploy, or delete the route in the dashboard.
