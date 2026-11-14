import assert from "node:assert/strict";
import { loadMonthlyOrders } from "../src/stats-data.js";

const calls = [];
const source = Array.from({ length: 1201 }, (_, id) => ({ id: String(id), items: [] }));
const client = {
  rpc(name, params) {
    return { async range(from, to) {
      calls.push({ name, month: params.selected_month, from, to });
      return { data: source.slice(from, to + 1), error: null };
    } };
  }
};
const result = await loadMonthlyOrders(client, "test-placeholder", "2026-11");
assert.equal(result.length, 1201, "Months larger than the API's default row limit are fully loaded");
assert.deepEqual(calls.map(({ from, to }) => [from, to]), [[0, 499], [500, 999], [1000, 1499]]);
assert.ok(calls.every((call) => call.name === "admin_list_orders_by_month" && call.month === "2026-11-01"));
await assert.rejects(loadMonthlyOrders(client, "test-placeholder", ""), /조회할 달/);
await assert.rejects(loadMonthlyOrders(client, "test-placeholder", "2026-13"), /조회할 달/);
const failed = { rpc: () => ({ range: async () => ({ data: null, error: new Error("offline") }) }) };
await assert.rejects(loadMonthlyOrders(failed, "test-placeholder", "2026-11"), /offline/);
const malformed = { rpc: () => ({ range: async () => ({ data: null, error: null }) }) };
await assert.rejects(loadMonthlyOrders(malformed, "test-placeholder", "2026-11"), /불러오지/);
let page = 0;
const overlap = { rpc: () => ({ range: async () => ({ data: page++ === 0 ? source.slice(0, 500) : [source[499], source[500]], error: null }) }) };
assert.equal((await loadMonthlyOrders(overlap, "test-placeholder", "2026-11")).length, 501);
console.log("Monthly analytics loading: pagination past 1,000 rows, overlap deduplication, validation, and failures passed.");
