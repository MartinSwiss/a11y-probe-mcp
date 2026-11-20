/** Thrown when Browser Run refuses another session (HTTP 429). */
export class BrowserBusyError extends Error {
  constructor() {
    super("Browser capacity is exhausted. Try again later.");
    this.name = "BrowserBusyError";
  }
}

/** Thrown when a single page exceeds the 30s budget. */
export class PageTimeoutError extends Error {
  constructor() {
    super("Page exceeded the 30s limit");
    this.name = "PageTimeoutError";
  }
}
