import assert from "node:assert/strict";
import { summarizeOrders } from "../src/stats.js";

const result = summarizeOrders([
  { order_day: "2026-09-16", status: "done", items: [{ name: "망고", quantity: 2 }] },
  { order_day: "2026-09-16", status: "new", items: [{ name: "자몽", quantity: 1 }] },
  { order_day: "2026-09-16", status: "canceled", items: [{ name: "망고", quantity: 9 }] }
]);

assert.deepEqual(result, {
  orders: 3,
  drinks: 3,
  active: 1,
  done: 1,
  canceled: 1,
  popular: [["망고", 2], ["자몽", 1]]
});

console.log("stats test passed");
