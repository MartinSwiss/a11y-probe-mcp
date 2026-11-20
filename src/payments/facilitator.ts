import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorConfig } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";

const CDP_HOST = "api.cdp.coinbase.com";

export function payToAddress(value: string): `0x${string}` | undefined {
  return /^0x[a-fA-F0-9]{40}$/.test(value) ? (value as `0x${string}`) : undefined;
}

export function facilitatorConfigFor(env: Env): FacilitatorConfig {
  const url = env.FACILITATOR_URL;
  const config: FacilitatorConfig = { url };
  if (new URL(url).hostname !== CDP_HOST) return config;
  if (!env.CDP_API_KEY_ID || !env.CDP_API_KEY_SECRET) {
    throw new Error("CDP facilitator credentials are not configured");
  }
  const parsed = new URL(url);
  const basePath = parsed.pathname.replace(/\/$/, "");
  const apiKeyId = env.CDP_API_KEY_ID;
  const apiKeySecret = env.CDP_API_KEY_SECRET;
  config.createAuthHeaders = async () => {
    const header = async (method: "GET" | "POST", path: string) => {
      const jwt = await generateJwt({
        apiKeyId,
        apiKeySecret,
        requestMethod: method,
        requestHost: parsed.host,
        requestPath: path,
      });
      return { Authorization: `Bearer ${jwt}` };
    };
    const [verify, settle, supported] = await Promise.all([
      header("POST", `${basePath}/verify`),
      header("POST", `${basePath}/settle`),
      header("GET", `${basePath}/supported`),
    ]);
    return { verify, settle, supported };
  };
  return config;
}

export function facilitatorClientFor(env: Env): HTTPFacilitatorClient {
  return new HTTPFacilitatorClient(facilitatorConfigFor(env));
}

const servers = new Map<string, Promise<x402ResourceServer>>();

export function resourceServerFor(env: Env): Promise<x402ResourceServer> {
  const key = `${env.FACILITATOR_URL}|${env.X402_NETWORK}|${env.PAY_TO}|${env.CDP_API_KEY_ID}`;
  const existing = servers.get(key);
  if (existing) return existing;
  const created = (async () => {
    const server = new x402ResourceServer(facilitatorClientFor(env));
    registerExactEvmScheme(server);
    server.registerExtension(bazaarResourceServerExtension);
    await server.initialize();
    return server;
  })();
  servers.set(key, created);
  created.catch(() => {
    if (servers.get(key) === created) servers.delete(key);
  });
  return created;
}

/** Test isolation. Production workers keep one client per configuration. */
export function resetResourceServers(): void {
  servers.clear();
}
