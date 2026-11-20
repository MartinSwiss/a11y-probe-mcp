export async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

export function utcDay(now: Date): string {
  return now.toISOString().slice(0, 10);
}

export async function hashDomain(hostname: string): Promise<string> {
  return sha256Hex(hostname.toLowerCase());
}
