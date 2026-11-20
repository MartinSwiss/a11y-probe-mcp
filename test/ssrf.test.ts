import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { followPublicRedirects, isNonPublicAddress, resolveWithDoh, validatePublicUrl } from "../src/scan/ssrf";
import { UA, publicDns, scriptedFetch } from "./helpers";

const signal = () => AbortSignal.timeout(5_000);

describe("SSRF guard", () => {
  it("rejects non-http schemes, credentials, and disallowed ports", async () => {
    const resolveAddresses = publicDns();
    await expect(validatePublicUrl("ftp://example.com/file", { resolveAddresses })).resolves.toMatchObject({
      ok: false,
      code: "ssrf",
    });
    await expect(validatePublicUrl("http://user:pass@example.com/", { resolveAddresses })).resolves.toMatchObject({
      ok: false,
      message: "URLs with credentials are not allowed",
    });
    await expect(validatePublicUrl("https://example.com:8443/", { resolveAddresses })).resolves.toMatchObject({
      ok: false,
      message: "Only port 443 is allowed for https",
    });
    await expect(validatePublicUrl("http://example.com:443/", { resolveAddresses })).resolves.toMatchObject({
      ok: false,
      message: "Only port 80 is allowed for http",
    });
  });

  it("rejects IP literals, including obfuscated forms the URL parser normalises", async () => {
    const resolveAddresses = publicDns();
    for (const raw of [
      "http://127.0.0.1/",
      "http://2130706433/",
      "http://0x7f000001/",
      "http://0177.0.0.1/",
      "http://127.1/",
      "http://[::1]/",
      "https://[::ffff:127.0.0.1]/",
      "http://169.254.169.254/latest/meta-data",
    ]) {
      const decision = await validatePublicUrl(raw, { resolveAddresses });
      expect(decision.ok, raw).toBe(false);
      if (!decision.ok) expect(decision.message).toMatch(/IP literal/);
    }
    expect(resolveAddresses).toBeTypeOf("function");
  });

  it("rejects metadata and local hostnames before DNS", async () => {
    let lookedUp = false;
    const resolveAddresses = async () => {
      lookedUp = true;
      return ["93.184.216.34"];
    };
    for (const raw of [
      "http://localhost/",
      "http://metadata.google.internal/computeMetadata/v1/",
      "http://metadata.google.com/",
      "http://instance-data.ec2.internal/",
      "http://foo.localhost/",
      "http://printer.local/",
    ]) {
      const decision = await validatePublicUrl(raw, { resolveAddresses });
      expect(decision.ok, raw).toBe(false);
    }
    expect(lookedUp).toBe(false);
  });

  it("rejects hostnames that resolve to a non-public address and fails closed on DNS errors", async () => {
    const privateHost = await validatePublicUrl("https://rebind.example/", {
      resolveAddresses: publicDns({ "rebind.example": ["10.0.0.5"] }),
    });
    expect(privateHost).toMatchObject({ ok: false, message: "URL targets a non-public address" });

    const mixed = await validatePublicUrl("https://mixed.example/", {
      resolveAddresses: publicDns({ "mixed.example": ["93.184.216.34", "127.0.0.1"] }),
    });
    expect(mixed.ok).toBe(false);

    const nx = await validatePublicUrl("https://missing.example/", {
      resolveAddresses: async () => {
        throw new Error("nxdomain");
      },
    });
    expect(nx).toMatchObject({ ok: false, message: "Could not confirm the host is public" });
  });

  it("allows a public https URL on port 443 and strips the fragment", async () => {
    const decision = await validatePublicUrl("https://Example.COM:443/a#secret", {
      resolveAddresses: publicDns(),
    });
    expect(decision).toMatchObject({ ok: true });
    if (decision.ok) expect(decision.url.href).toBe("https://example.com/a");
  });

  it("classifies private, loopback, link-local, and public addresses", () => {
    expect(isNonPublicAddress("8.8.8.8")).toBe(false);
    expect(isNonPublicAddress("93.184.216.34")).toBe(false);
    for (const address of ["0.0.0.0", "10.1.2.3", "127.0.0.1", "169.254.169.254", "172.16.5.5", "192.168.0.2", "100.64.0.1", "224.0.0.1"]) {
      expect(isNonPublicAddress(address), address).toBe(true);
    }
    expect(isNonPublicAddress("2001:4860:4860::8888")).toBe(false);
    expect(isNonPublicAddress("::1")).toBe(true);
    expect(isNonPublicAddress("::")).toBe(true);
    expect(isNonPublicAddress("fc00::1")).toBe(true);
    expect(isNonPublicAddress("fd12:3456::1")).toBe(true);
    expect(isNonPublicAddress("fe80::1")).toBe(true);
    expect(isNonPublicAddress("::ffff:127.0.0.1")).toBe(true);
    expect(isNonPublicAddress("::ffff:8.8.8.8")).toBe(false);
  });

  it("re-checks every redirect and stops after five hops", async () => {
    const hops: Record<string, { status?: number; headers?: Record<string, string> }> = {};
    for (let i = 0; i < 6; i++) {
      hops[`https://example.com/${i}`] = { status: 302, headers: { location: `https://example.com/${i + 1}` } };
    }
    hops["https://example.com/6"] = { status: 200, headers: { "content-type": "text/html" } };
    const fetchImpl = scriptedFetch(hops);
    const decision = await followPublicRedirects("https://example.com/0", {
      fetch: fetchImpl,
      resolveAddresses: publicDns(),
      userAgent: UA,
      signal: signal(),
    });
    expect(decision.ok).toBe(false);
    if (!decision.ok) expect(decision.message).toBe("Too many redirects");
  });

  it("rejects a redirect loop", async () => {
    const fetchImpl = scriptedFetch({
      "https://example.com/a": { status: 302, headers: { location: "https://example.com/b" } },
      "https://example.com/b": { status: 302, headers: { location: "https://example.com/a" } },
    });
    const decision = await followPublicRedirects("https://example.com/a", {
      fetch: fetchImpl,
      resolveAddresses: publicDns(),
      userAgent: UA,
      signal: signal(),
    });
    expect(decision).toMatchObject({ ok: false, message: "Redirect loop" });
  });

  it("sends only the scanner user agent and an accept header", async () => {
    let headers: Headers | undefined;
    const fetchImpl: typeof fetch = async (_input, init) => {
      headers = new Headers(init?.headers);
      return new Response("", { status: 200, headers: { "content-type": "text/html" } });
    };
    await followPublicRedirects("https://example.com/page", {
      fetch: fetchImpl,
      resolveAddresses: publicDns(),
      userAgent: UA,
      signal: signal(),
    });
    expect(headers?.get("user-agent")).toBe(UA);
    expect(headers?.get("accept")).toContain("text/html");
    expect(headers?.get("cookie")).toBeNull();
    expect(headers?.get("authorization")).toBeNull();
  });

  it("rejects a redirect onto a loopback address", async () => {
    const fetchImpl = scriptedFetch({
      "https://example.com/start": { status: 302, headers: { location: "http://127.0.0.1/admin" } },
    });
    const decision = await followPublicRedirects("https://example.com/start", {
      fetch: fetchImpl,
      resolveAddresses: publicDns(),
      userAgent: UA,
      signal: signal(),
    });
    expect(decision).toMatchObject({ ok: false, message: "IP literals are not allowed" });
  });

  it("rejects a redirect to a host that resolves privately", async () => {
    const fetchImpl = scriptedFetch({
      "https://example.com/start": { status: 302, headers: { location: "https://rebind.example/hide" } },
    });
    const decision = await followPublicRedirects("https://example.com/start", {
      fetch: fetchImpl,
      resolveAddresses: publicDns({ "rebind.example": ["192.168.1.9"] }),
      userAgent: UA,
      signal: signal(),
    });
    expect(decision).toMatchObject({ ok: false, message: "URL targets a non-public address" });
  });

  it("resolves public addresses through the DNS-over-HTTPS client", async () => {
    const fetchImpl: typeof fetch = async (input) => {
      const url = String(input);
      const type = new URL(url).searchParams.get("type");
      const answer = type === "AAAA" ? { type: 28, data: "2001:4860:4860::8888" } : { type: 1, data: "8.8.8.8" };
      return Response.json({ Status: 0, Answer: [answer] });
    };
    await expect(resolveWithDoh("dns.google", fetchImpl)).resolves.toEqual(["8.8.8.8", "2001:4860:4860::8888"]);
  });

  it("asks for a manual DoH redirect and fails closed instead of following it", async () => {
    const seen: Array<RequestRedirect | undefined> = [];
    const fetchImpl: typeof fetch = async (_input, init) => {
      seen.push(init?.redirect);
      return new Response(null, { status: 302, headers: { location: "http://169.254.169.254/latest" } });
    };
    await expect(resolveWithDoh("example.com", fetchImpl)).rejects.toThrow(/dns lookup failed/);
    expect(seen).toEqual(["manual"]);
  });
});

describe("keep_names", () => {
  it("is disabled so the rule engine source can be evaluated in the page", () => {
    const config = readFileSync(new URL("../wrangler.jsonc", import.meta.url), "utf8");
    expect(config).toMatch(/"keep_names"\s*:\s*false/);
  });
});
