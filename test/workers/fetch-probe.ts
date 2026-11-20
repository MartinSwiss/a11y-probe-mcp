import { scanDependencies } from "../../src/app";

const robots = {
  method: "GET" as const,
  redirect: "manual" as const,
  headers: {
    "user-agent": "A11yProbe/1.0 (+https://a11y-probe.example/)",
    accept: "text/plain",
  },
};

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const path = new URL(request.url).pathname;
    if (path === "/detached") {
      const detached = { fetch };
      try {
        const response = await detached.fetch("https://example.com/robots.txt", robots);
        await response.body?.cancel();
        return Response.json({ threw: false, status: response.status });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        return Response.json({ threw: true, message });
      }
    }

    const deps = scanDependencies(env, {});
    const response = await deps.fetch("https://example.com/robots.txt", robots);
    const status = response.status;
    await response.body?.cancel();
    return Response.json({ status });
  },
};
