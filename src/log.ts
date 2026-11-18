/** The only fields this worker logs. No URLs, page content, or other personal data. */
export interface PaymentLog {
  timestamp: string;
  tool: string;
  price: number;
  tx: string;
  payer: string;
  domainHash: string;
}

const ALLOWED = new Set(["timestamp", "tool", "price", "tx", "payer", "domainHash"]);

export function logPayment(entry: PaymentLog): void {
  const safe: Record<string, string | number> = {};
  for (const key of ALLOWED) {
    const value = entry[key as keyof PaymentLog];
    if (typeof value === "string" || typeof value === "number") safe[key] = value;
  }
  console.log(JSON.stringify(safe));
}
