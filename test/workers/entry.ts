/** Minimal worker so the workerd test pool has an entry. The test calls resolveWithDoh directly. */
export default {
  async fetch(): Promise<Response> {
    return new Response("doh-test");
  },
};
