import { launch, type BrowserWorker } from "@cloudflare/playwright";
import axe from "axe-core";
import { LIMITS, tagsForStandard, type Standard } from "../config";
import { BrowserBusyError, PageTimeoutError } from "./errors";
import type { InspectedDocument } from "./scan";
import { validatePublicUrl, validateUrlShape, type GuardDeps } from "./ssrf";

export interface BrowserInspectOptions extends GuardDeps {
  userAgent: string;
}

/**
 * Load a page in Browser Run and run the rule engine inside that page.
 * No cookies, no caller headers, no form posts. Every navigation is checked
 * again for scheme, port, IP literals, and resolved addresses.
 */
export async function inspectWithBrowser(
  binding: BrowserWorker,
  url: URL,
  standard: Standard,
  signal: AbortSignal,
  options: BrowserInspectOptions,
): Promise<InspectedDocument> {
  if (signal.aborted) throw new PageTimeoutError();

  let browser: Awaited<ReturnType<typeof launch>> | undefined;
  try {
    try {
      browser = await launch(binding, { keep_alive: LIMITS.pageTimeoutMs });
    } catch (error) {
      if (isBrowserCapacity(error)) throw new BrowserBusyError();
      throw error;
    }

    const context = await browser.newContext({ userAgent: options.userAgent });
    const page = await context.newPage();
    let blocked: string | undefined;

    await page.route("**/*", async (route) => {
      const request = route.request();
      const method = request.method();
      if (method !== "GET" && method !== "HEAD") {
        await route.abort("blockedbyclient");
        return;
      }
      const shape = validateUrlShape(request.url());
      if (!shape.ok) {
        if (request.isNavigationRequest()) blocked = shape.message;
        await route.abort("blockedbyclient");
        return;
      }
      if (request.isNavigationRequest()) {
        const decision = await validatePublicUrl(request.url(), options);
        if (!decision.ok) {
          blocked = decision.message;
          await route.abort("blockedbyclient");
          return;
        }
      }
      await route.continue();
    });

    try {
      await page.goto(url.href, {
        timeout: LIMITS.pageTimeoutMs,
        waitUntil: "load",
      });
    } catch (error) {
      if (blocked) throw new Error(blocked);
      if (isTimeout(error) || signal.aborted) throw new PageTimeoutError();
      if (isBrowserCapacity(error)) throw new BrowserBusyError();
      throw error;
    }

    await page.evaluate((source: string) => {
      (0, eval)(source);
    }, axe.source);

    const tags = tagsForStandard(standard);
    const payload = await page.evaluate((wanted: string[]) => {
      const engine = (globalThis as unknown as {
        axe?: {
          version?: string;
          getRules: () => Array<{ tags?: string[] }>;
          run: (context: Document, options: unknown) => Promise<unknown>;
        };
      }).axe;
      if (!engine) throw new Error("rule engine did not start");
      const known = new Set(engine.getRules().flatMap((rule) => rule.tags ?? []));
      const runOnly = wanted.filter((tag) => known.has(tag));
      const links = [...document.querySelectorAll("a[href]")].map((node) => (node as HTMLAnchorElement).href);
      return engine.run(document, {
        runOnly: { type: "tag", values: runOnly },
        resultTypes: ["violations", "incomplete", "passes"],
      }).then((raw) => ({ raw, links, version: engine.version ?? "" }));
    }, tags);

    const raw = payload.raw as InspectedDocument["raw"];
    if (raw.testEngine && !raw.testEngine.version && payload.version) {
      raw.testEngine.version = payload.version;
    }
    return { raw, links: payload.links };
  } catch (error) {
    if (error instanceof BrowserBusyError || error instanceof PageTimeoutError) throw error;
    if (isTimeout(error) || signal.aborted) throw new PageTimeoutError();
    if (isBrowserCapacity(error)) throw new BrowserBusyError();
    throw error;
  } finally {
    await browser?.close().catch(() => undefined);
  }
}

function isTimeout(error: unknown): boolean {
  return error instanceof Error && (error.name === "TimeoutError" || error.name === "AbortError");
}

function isBrowserCapacity(error: unknown): boolean {
  const message = error instanceof Error ? `${error.name} ${error.message}` : String(error);
  return /\b429\b/.test(message) || /rate limit exceeded/i.test(message);
}
