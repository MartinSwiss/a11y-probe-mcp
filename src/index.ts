import { userAgent } from "./config";
import { createApp } from "./app";
import { inspectWithBrowser } from "./scan/browser";
import { resolveWithDoh } from "./scan/ssrf";

export default createApp({
  createInspect(env) {
    const resolveAddresses = (hostname: string) => resolveWithDoh(hostname);
    const agent = userAgent(env.INFO_URL);
    return (url, standard, signal) =>
      inspectWithBrowser(env.BROWSER, url, standard, signal, { userAgent: agent, resolveAddresses });
  },
});
