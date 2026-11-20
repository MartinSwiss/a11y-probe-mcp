import { LIMITS } from "../config";
import { normaliseUrl, type NormaliseResult } from "./url";
import { failure, type ScanFailure } from "./types";

export type GuardResult = { ok: true; url: URL } | ScanFailure;

const BLOCKED_HOSTS = new Set([
  "localhost",
  "localhost.localdomain",
  "metadata",
  "metadata.google.internal",
  "metadata.google.com",
  "instance-data",
  "instance-data.ec2.internal",
  "kubernetes",
  "kubernetes.default",
  "kubernetes.default.svc",
  "kubernetes.default.svc.cluster.local",
]);

function hostnameOf(url: URL): string {
  const host = url.hostname.toLowerCase();
  // WHATWG keeps brackets on IPv6 hostnames. Comparisons use the inner form.
  if (host.startsWith("[") && host.endsWith("]")) return host.slice(1, -1);
  return host;
}

export function isBlockedHostname(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/\.$/, "");
  if (BLOCKED_HOSTS.has(host)) return true;
  if (host.endsWith(".localhost") || host.endsWith(".local") || host.endsWith(".internal")) {
    return true;
  }
  if (host.endsWith(".localdomain")) return true;
  return false;
}

function ipv4ToInt(host: string): number | null {
  const parts = host.split(".");
  if (parts.length !== 4) return null;
  let value = 0;
  for (const part of parts) {
    if (!/^\d{1,3}$/.test(part)) return null;
    const octet = Number(part);
    if (!Number.isInteger(octet) || octet > 255) return null;
    value = (value << 8) + octet;
  }
  return value >>> 0;
}

/** True for dotted IPv4 and for any IPv6 literal (with or without brackets). */
export function isIpLiteral(hostname: string): boolean {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (ipv4ToInt(host) !== null) return true;
  return host.includes(":");
}

function inCidr(value: number, network: number, bits: number): boolean {
  if (bits === 0) return true;
  const mask = bits === 32 ? 0xffffffff : (0xffffffff << (32 - bits)) >>> 0;
  return (value & mask) === (network & mask);
}

/** Non-routable, private, loopback, link-local, documentation, and multicast. */
export function isNonPublicAddress(address: string): boolean {
  const addr = address.trim().toLowerCase().replace(/^\[|\]$/g, "");
  if (addr.includes(":")) return isNonPublicV6(addr);
  const v4 = ipv4ToInt(addr);
  if (v4 === null) return true;
  return isNonPublicV4(v4);
}

function isNonPublicV4(value: number): boolean {
  const ranges: Array<[number, number]> = [
    [ipv4ToInt("0.0.0.0")!, 8],
    [ipv4ToInt("10.0.0.0")!, 8],
    [ipv4ToInt("100.64.0.0")!, 10],
    [ipv4ToInt("127.0.0.0")!, 8],
    [ipv4ToInt("169.254.0.0")!, 16],
    [ipv4ToInt("172.16.0.0")!, 12],
    [ipv4ToInt("192.0.0.0")!, 24],
    [ipv4ToInt("192.0.2.0")!, 24],
    [ipv4ToInt("192.168.0.0")!, 16],
    [ipv4ToInt("198.18.0.0")!, 15],
    [ipv4ToInt("198.51.100.0")!, 24],
    [ipv4ToInt("203.0.113.0")!, 24],
    [ipv4ToInt("224.0.0.0")!, 4],
    [ipv4ToInt("240.0.0.0")!, 4],
  ];
  if (ranges.some(([network, bits]) => inCidr(value, network, bits))) return true;
  return value === 0xffffffff;
}

function ipv6ToBigInt(input: string): bigint | null {
  let addr = input.toLowerCase();
  const v4 = addr.match(/^(.*:)(\d+\.\d+\.\d+\.\d+)$/);
  if (v4) {
    const mapped = ipv4ToInt(v4[2] ?? "");
    if (mapped === null) return null;
    const hi = ((mapped >>> 16) & 0xffff).toString(16);
    const lo = (mapped & 0xffff).toString(16);
    addr = `${v4[1]}${hi}:${lo}`;
  }
  const halves = addr.split("::");
  if (halves.length > 2) return null;
  const head = halves[0] ? halves[0]!.split(":") : [];
  const tail = halves.length === 2 && halves[1] ? halves[1].split(":") : [];
  if (halves.length === 1 && head.length !== 8) return null;
  const missing = 8 - head.length - tail.length;
  // "::" must compress at least one group.
  if (halves.length === 2 && missing < 1) return null;
  const zeros = halves.length === 2 ? Array<string>(missing).fill("0") : [];
  const parts = halves.length === 2 ? [...head, ...zeros, ...tail] : head;
  if (parts.length !== 8) return null;
  let value = 0n;
  for (const part of parts) {
    if (!/^[0-9a-f]{1,4}$/.test(part)) return null;
    value = (value << 16n) + BigInt(parseInt(part, 16));
  }
  return value;
}

function isNonPublicV6(addr: string): boolean {
  const value = ipv6ToBigInt(addr);
  if (value === null) return true;
  if (value === 0n || value === 1n) return true;
  const top7 = value >> 121n;
  if (top7 === 0b1111110n) return true; // fc00::/7
  const top10 = value >> 118n;
  if (top10 === 0b1111111010n) return true; // fe80::/10
  if (value >> 120n === 0xffn) return true; // ff00::/8 multicast
  if (value >> 96n === 0x20010db8n) return true; // 2001:db8::/32
  if (value >> 64n === 0x100n) return true; // 100::/64 discard
  // IPv4-mapped ::ffff:0:0/96
  if (value >> 32n === 0xffffn) return isNonPublicV4(Number(value & 0xffffffffn));
  // NAT64 well-known prefix 64:ff9b::/96 — judge the embedded IPv4.
  if (value >> 32n === 0x0064ff9b00000000n) return isNonPublicV4(Number(value & 0xffffffffn));
  return false;
}

function schemeAndPort(url: URL): string | null {
  if (url.protocol === "https:") {
    if (url.port === "" || url.port === "443") return null;
    return "Only port 443 is allowed for https";
  }
  if (url.protocol === "http:") {
    if (url.port === "" || url.port === "80") return null;
    return "Only port 80 is allowed for http";
  }
  return "Only http and https URLs are allowed";
}

export interface GuardDeps {
  resolveAddresses: (hostname: string) => Promise<string[]>;
}

/**
 * Scheme, port, metadata-host, and IP-literal checks. No DNS. Used for every
 * browser request, including subresources, before a navigation is resolved.
 */
export function validateUrlShape(input: string, base?: string): GuardResult {
  const normalised: NormaliseResult = normaliseUrl(input, base);
  if (!normalised.ok) return failure("ssrf", normalised.message);
  const url = normalised.url;

  const portError = schemeAndPort(url);
  if (portError) return failure("ssrf", portError);

  const host = hostnameOf(url);
  if (host === "") return failure("ssrf", "URL host is empty");
  if (isBlockedHostname(host)) return failure("ssrf", "URL host is not allowed");
  if (isIpLiteral(host) || isIpLiteral(url.hostname)) {
    return failure("ssrf", "IP literals are not allowed");
  }
  return { ok: true, url };
}

/**
 * Shape checks plus resolved-address checks. Does not follow redirects.
 * Call this again for every hop.
 */
export async function validatePublicUrl(input: string, deps: GuardDeps, base?: string): Promise<GuardResult> {
  const shape = validateUrlShape(input, base);
  if (!shape.ok) return shape;
  const url = shape.url;
  const host = hostnameOf(url);

  let addresses: string[];
  try {
    addresses = await deps.resolveAddresses(host);
  } catch {
    return failure("ssrf", "Could not confirm the host is public");
  }
  if (addresses.length === 0 || addresses.some((address) => isNonPublicAddress(address))) {
    return failure("ssrf", "URL targets a non-public address");
  }
  return { ok: true, url };
}

interface DohAnswer {
  type?: number;
  data?: string;
}

interface DohResponse {
  Status?: number;
  Answer?: DohAnswer[];
}

/**
 * Call the runtime fetch with its own receiver. Putting the global `fetch` on
 * an object and calling it as a method throws in workerd
 * (`Illegal invocation`).
 */
export function boundFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  return fetch(input, init);
}

/**
 * Resolve A and AAAA records through Cloudflare DNS-over-HTTPS. Fail closed.
 * Workers accept only "follow" and "manual" for redirect. "manual" keeps a 3xx
 * from being chased, and a non-OK status (including 3xx) is rejected below.
 */
export async function resolveWithDoh(hostname: string, fetchImpl: typeof fetch = boundFetch): Promise<string[]> {
  const addresses: string[] = [];
  for (const type of ["A", "AAAA"] as const) {
    const endpoint = `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=${type}`;
    const response = await fetchImpl(endpoint, {
      method: "GET",
      redirect: "manual",
      headers: { accept: "application/dns-json" },
    });
    if (!response.ok || response.type === "opaqueredirect") {
      await response.body?.cancel().catch(() => undefined);
      throw new Error("dns lookup failed");
    }
    const body = (await response.json()) as DohResponse;
    if (body.Status !== 0) throw new Error("dns lookup failed");
    for (const answer of body.Answer ?? []) {
      if ((answer.type === 1 || answer.type === 28) && typeof answer.data === "string" && answer.data !== "") {
        addresses.push(answer.data);
      }
    }
  }
  if (addresses.length === 0) throw new Error("dns lookup returned no addresses");
  return addresses;
}

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);

export interface FollowDeps extends GuardDeps {
  fetch: typeof fetch;
  userAgent: string;
  signal: AbortSignal;
}

export type FollowResult = { ok: true; url: URL; response: Response } | ScanFailure;

/**
 * Follow up to {@link LIMITS.maxRedirects} redirects. Every hop is normalised
 * and checked again, including after the DNS answer changes.
 */
export async function followPublicRedirects(input: string, deps: FollowDeps): Promise<FollowResult> {
  let current = input;
  const seen = new Set<string>();

  for (let hop = 0; hop <= LIMITS.maxRedirects; hop++) {
    const decision = await validatePublicUrl(current, deps);
    if (!decision.ok) return decision;
    if (seen.has(decision.url.href)) return failure("ssrf", "Redirect loop");
    seen.add(decision.url.href);

    let response: Response;
    try {
      response = await deps.fetch(decision.url, {
        method: "GET",
        redirect: "manual",
        signal: deps.signal,
        headers: {
          "user-agent": deps.userAgent,
          accept: "text/html,application/xhtml+xml",
        },
      });
    } catch (error) {
      if (isAbort(error)) return failure("timeout", "Page exceeded the 30s limit");
      return failure("fetch_failed", "Page could not be fetched");
    }

    if (REDIRECT_STATUSES.has(response.status)) {
      await cancelBody(response);
      const location = response.headers.get("location");
      if (!location) return failure("fetch_failed", "Redirect missing location");
      if (hop === LIMITS.maxRedirects) return failure("ssrf", "Too many redirects");
      const next = normaliseUrl(location, decision.url.href);
      if (!next.ok) return failure("ssrf", next.message);
      current = next.url.href;
      continue;
    }

    if (response.status >= 400) {
      await cancelBody(response);
      return failure("fetch_failed", "Page could not be fetched");
    }
    return { ok: true, url: decision.url, response };
  }

  return failure("ssrf", "Too many redirects");
}

async function cancelBody(response: Response): Promise<void> {
  try {
    await response.body?.cancel();
  } catch {
    // The caller already has the status and headers it needs.
  }
}

function isAbort(error: unknown): boolean {
  return error instanceof Error && error.name === "AbortError";
}
