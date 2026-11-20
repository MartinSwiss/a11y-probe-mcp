import { generateJwt } from "@coinbase/cdp-sdk/auth";
import { HTTPFacilitatorClient, x402ResourceServer, type FacilitatorConfig } from "@x402/core/server";
import { registerExactEvmScheme } from "@x402/evm/exact/server";
import { bazaarResourceServerExtension } from "@x402/extensions/bazaar";
import { getAddress, isAddress } from "viem";

const CDP_HOST = "api.cdp.coinbase.com";

export class PayToError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PayToError";
  }
}

/**
 * Accept an EIP-55 address. Mixed-case values must match their checksum.
 * All-lowercase and all-uppercase hex are accepted and returned checksummed.
 * Called at the start of every request so a bad PAY_TO never reaches a scan.
 */
export function assertPayTo(value: string): `0x${string}` {
  if (!isAddress(value)) {
    throw new PayToError("PAY_TO is not a valid address");
  }
  let checksummed: `0x${string}`;
  try {
    checksummed = getAddress(value);
  } catch {
    throw new PayToError("PAY_TO is not a valid address");
  }
  const uniformCase = value === value.toLowerCase() || value === value.toUpperCase();
  if (!uniformCase && value !== checksummed) {
    throw new PayToError("PAY_TO checksum is invalid");
  }
  return checksummed;
}

export function payToAddress(value: string): `0x${string}` | undefined {
  try {
    return assertPayTo(value);
  } catch {
    return undefined;
  }
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
