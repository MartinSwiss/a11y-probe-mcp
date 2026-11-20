import { describe, expect, it } from "vitest";
import { boundFetch } from "../../src/scan/ssrf";

describe("fetch receiver inside the pool workerd", () => {
  it("reads robots.txt when fetch is stored on an object the way scanDependencies does", async () => {
    const deps = { fetch: boundFetch };
    const response = await deps.fetch("https://example.com/robots.txt", {
      method: "GET",
      redirect: "manual",
      headers: {
        "user-agent": "A11yProbe/1.0 (+https://a11y-probe.example/)",
        accept: "text/plain",
      },
    });
    expect(response.status).toBeGreaterThanOrEqual(200);
    expect(response.status).toBeLessThan(500);
    await response.body?.cancel();
  });
});
