import { createServer, type Server } from "node:http";
import { readFile } from "node:fs/promises";
import { join, normalize, sep } from "node:path";
import axe from "axe-core";
import { JSDOM, VirtualConsole } from "jsdom";
import { tagsForStandard, userAgent, type Standard } from "../src/config";
import type { ScanDeps } from "../src/scan/scan";
import type { RawAxeResults } from "../src/scan/types";

export const UA = userAgent("https://a11y-probe.example/");

export function publicDns(overrides: Record<string, string[]> = {}): (host: string) => Promise<string[]> {
  return async (host: string) => {
    if (Object.prototype.hasOwnProperty.call(overrides, host)) return overrides[host] ?? [];
    return ["93.184.216.34"];
  };
}

export interface Route {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

export function scriptedFetch(routes: Record<string, Route>): typeof fetch & { urls: string[] } {
  const urls: string[] = [];
  const impl: typeof fetch = async (input) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    urls.push(url);
    const route = routes[url];
    if (!route) return new Response("missing", { status: 404 });
    const headers = new Headers(route.headers);
    return new Response(route.body ?? "", { status: route.status ?? 200, headers });
  };
  return Object.assign(impl, { urls });
}

export function depsFor(fetchImpl: typeof fetch, resolveAddresses = publicDns()): ScanDeps {
  return {
    fetch: fetchImpl,
    resolveAddresses,
    userAgent: UA,
    now: () => new Date("2026-11-18T12:00:00.000Z"),
    auditHtml,
  };
}

export async function auditHtml(html: string, standard: Standard): Promise<RawAxeResults> {
  const virtualConsole = new VirtualConsole();
  const dom = new JSDOM(html, {
    url: "https://fixture.example/",
    runScripts: "dangerously",
    virtualConsole,
  });
  try {
    dom.window.eval(axe.source);
    const engine = (
      dom.window as unknown as {
        axe: {
          version: string;
          getRules: () => Array<{ tags?: string[] }>;
          run: (node: unknown, options: unknown) => Promise<RawAxeResults>;
        };
      }
    ).axe;
    const known = new Set(engine.getRules().flatMap((rule) => rule.tags ?? []));
    const tags = tagsForStandard(standard).filter((tag) => known.has(tag));
    return await engine.run(dom.window.document, {
      runOnly: { type: "tag", values: tags },
      resultTypes: ["violations", "incomplete", "passes"],
    });
  } finally {
    dom.window.close();
  }
}

export async function serveDir(root: string): Promise<{ url: string; close: () => Promise<void> }> {
  const rootWithSep = root.endsWith(sep) ? root : root + sep;
  const server: Server = createServer(async (request, response) => {
    const pathname = decodeURIComponent(new URL(request.url ?? "/", "http://127.0.0.1").pathname);
    const file = normalize(join(root, pathname));
    if (file !== root && !file.startsWith(rootWithSep)) {
      response.writeHead(403);
      response.end("forbidden");
      return;
    }
    try {
      const body = await readFile(file);
      response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
      response.end(body);
    } catch {
      response.writeHead(404);
      response.end("not found");
    }
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("fixture server has no port");
  return {
    url: `http://127.0.0.1:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}
