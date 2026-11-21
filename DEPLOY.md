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

Daily page caps use one KV namespace per environment. Both already exist. Do not swap them.

- Testnet (`CAPS` on the top-level config): `10c7bfb486484f00b9fe8719a1f38f63`
- Production (`env.production`): `21c1d97792aa46ca8fa62dfa1f720b43`

The rate limiter binding (`RATE_LIMITER`, namespace id `1001`, 10 requests per 60 seconds) and the Browser Run binding (`BROWSER`) are declared in the config. They are created with the Worker. No separate purchase.

## 3. Payee address and secrets

`PAY_TO` is already set in `wrangler.jsonc` for the testnet environment and for `env.production`. It is a public Base address, read from the environment at runtime. You do not set it before the first deploy.

To point settlements at a different wallet, including a future Stripe crypto deposit address, change the `PAY_TO` var in both environments and redeploy, or override just that binding without editing code:

```sh
npx wrangler secret put PAY_TO --env=""
npx wrangler secret put PAY_TO --env production
```

A secret named `PAY_TO` replaces the var of the same name. Do not commit the new value if you use the secret path.

CDP keys are real secrets, and only the mainnet facilitator uses them. The top-level testnet config does not list `CDP_API_KEY_ID` or `CDP_API_KEY_SECRET` as required. Do not put placeholder CDP secrets on the testnet Worker.

Production requires both secrets. They are set with Wrangler and are not in the repo. To set or rotate them:

```sh
npx wrangler secret put CDP_API_KEY_ID --env production
npx wrangler secret put CDP_API_KEY_SECRET --env production
```

`env.production` uses `eip155:8453` and `https://api.cdp.coinbase.com/platform/v2/x402`. The same `PAY_TO` var applies there.

## 4. Public info URL

`INFO_URL` is `https://a11y.aiagentpay.cloud/` in the testnet config and in `env.production`. That value is the user-agent contact URL (`A11yProbe/1.0 (+https://a11y.aiagentpay.cloud/)`) and the base for the terms and privacy links. Change it in both environments if the public origin changes, then deploy again.

## 5. Deploy testnet

```sh
npx wrangler deploy --env=""
```

`--env=""` is the top-level testnet config. A bare `wrangler deploy` warns when named environments exist. This command uploads the Worker and the `public/` assets (home page, 404 page, and `/legal`), because `assets.directory` is set. `/mcp` and `/api/*` still run the Worker first. The top-level config does not declare `a11y.aiagentpay.cloud` and does not set `workers_dev`, so testnet stays on the `workers.dev` hostname this command prints. The custom domain belongs to `env.production` only.

Then set `ORIGIN` to that `workers.dev` URL:

```sh
curl -s "$ORIGIN/api/v1/pricing"
curl -s -D - -o /dev/null -X POST "$ORIGIN/api/v1/scan/page" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/","authorized":true}'
```

The scan request should be **402** with a `payment-required` header, not a charge. `preview_urls` is false, so this deploy does not create a version preview URL. `workers.dev` on this environment is unchanged. The public site checks are in the production section.

Optional local check before deploy:

```sh
cp .dev.vars.example .dev.vars
# PAY_TO comes from wrangler.jsonc. CDP keys are unused on testnet.
npx wrangler dev --env=""
```

## 6. MCP Inspector

```sh
npx @modelcontextprotocol/inspector
```

Connect it to `https://a11y.aiagentpay.cloud/mcp` with Streamable HTTP. `get_pricing` is free. A paid tool returns an x402 payment error until the client pays. Do not point the inspector at a mainnet worker with a funded wallet unless you mean to spend USDC.

## 7. Registry and Glama

`server.json` is the official MCP registry manifest. The name is `io.github.MartinSwiss/a11y-probe-mcp`. The remote URL is `https://a11y.aiagentpay.cloud/mcp`. Publishing is a separate step. Do it only after the testnet deploy answers. `glama.json` only lists maintainers; its schema has no URL field. Glama can launch the stdio entry, which proxies paid calls to the Worker:

```json
{
  "mcpServers": {
    "a11y-probe": {
      "command": "node",
      "args": ["--experimental-strip-types", "src/stdio.ts"],
      "env": { "A11Y_PROBE_URL": "https://a11y.aiagentpay.cloud" }
    }
  }
}
```

`get_pricing` works without `A11Y_PROBE_URL`. Paid tools do not.

## 8. Production

Production is live on Base (`eip155:8453`). `PAY_TO` and `INFO_URL` are already in `env.production`. The `CAPS` namespace is `21c1d97792aa46ca8fa62dfa1f720b43`. CDP secrets are already set with `wrangler secret put --env production` (step 3). Redeploy with:

```sh
npx wrangler deploy --env production
```

That command uploads the Worker and `public/` assets, keeps `workers_dev` off for this environment, and attaches the custom domain:

```json
{ "pattern": "a11y.aiagentpay.cloud", "custom_domain": true }
```

The top-level testnet config does not include that route. Then:

```sh
ORIGIN=https://a11y.aiagentpay.cloud
curl -s "$ORIGIN/api/v1/pricing"
curl -s -D - -o /dev/null -X POST "$ORIGIN/api/v1/scan/page" \
  -H 'content-type: application/json' \
  -d '{"url":"https://example.com/","authorized":true}'
```

The scan request should be **402** with a `payment-required` header, not a charge. Confirm `/`, `/legal/terms`, `/legal/privacy`, and `/legal/imprint` load. The imprint names Martin Ma. The legal pages stay marked draft until counsel reviews them. A settled call spends USDC on Base, so use an amount you accept (0.05 USDC for one page).

Workers Free includes Browser Run's free daily minutes. The global page cap defaults to 20 so a day of scans stays inside that allowance. Raise `GLOBAL_DAILY_PAGE_CAP` only if you accept Browser Run charges.

## Rollback

`npx wrangler rollback --env production` restores the previous production Worker version. It does not restore KV counters, secrets, or the custom domain.

To move `a11y.aiagentpay.cloud` off production and back onto the default Worker:

1. Remove the `routes` block from `env.production` in `wrangler.jsonc`.
2. Reattach the custom domain to the Worker named `a11y-probe-mcp`.
3. Deploy production again only after the route is gone, so that deploy does not take the hostname back: `npx wrangler deploy --env production`.

To stop charges immediately, override `PAY_TO` with `npx wrangler secret put PAY_TO --env production` using an address you control. Do not commit that value.
