import assert from "node:assert/strict";
import { reorderedMenuIds } from "../src/menu-order.js";
import { activeOrderKey, clearActiveOrder, orderLookupCode, readActiveOrder, saveActiveOrder } from "../src/order-storage.js";
import { ordersToCsv, summarizeOrders } from "../src/stats.js";

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

const csv = ordersToCsv([{
  order_number: 26,
  created_at: "2026-09-16T08:30:00Z",
  customer_name: "=테스트",
  party_size: 3,
  items: [{ name: "망고, 에이드", quantity: 2 }, { name: "자몽", quantity: 1 }],
  status: "done"
}]);

assert.equal(csv, '"주문번호","주문일시","주문자","인원수","주문메뉴","상태"\r\n"A026","2026-09-16 17:30","\'=테스트","3명","망고, 에이드 2잔 / 자몽 1잔","완료"');

console.log("csv test passed");

const values = new Map();
const storage = {
  getItem: (key) => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, value),
  removeItem: (key) => values.delete(key)
};
const savedOrder = { id: "order-1", customer_name: "테스트", party_size: 2, items: [{ name: "망고", quantity: 2 }] };
assert.equal(saveActiveOrder(storage, savedOrder), true);
assert.equal(storage.getItem(activeOrderKey), "order-1");
assert.deepEqual(readActiveOrder(storage), savedOrder);
clearActiveOrder(storage);
assert.equal(readActiveOrder(storage), null);

console.log("order storage test passed");

assert.equal(orderLookupCode({ order_number: 26 }), "026");
assert.equal(orderLookupCode({ order_number: 1026 }), "026");
assert.equal(orderLookupCode(null), "");

console.log("order lookup code test passed");

const menu = [
  { id: "ade-1", category: "ADE" },
  { id: "non-1", category: "NON SODA" },
  { id: "ade-2", category: "ADE" },
  { id: "non-2", category: "NON SODA" }
];
assert.deepEqual(reorderedMenuIds(menu, "ade-2", "up"), ["ade-2", "non-1", "ade-1", "non-2"]);
assert.deepEqual(reorderedMenuIds(menu, "non-1", "down"), ["ade-1", "non-2", "ade-2", "non-1"]);
assert.equal(reorderedMenuIds(menu, "ade-1", "up"), null);

console.log("menu order test passed");
