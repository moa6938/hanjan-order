import assert from "node:assert/strict";
import { analyzeOrders } from "../src/stats.js";

const options = { month: "2026-11", today: "2026-11-14" };
const empty = analyzeOrders([], options);
assert.equal(empty.daily.length, 14);
assert.equal(empty.weekdays.length, 7);
assert.equal(empty.hours.length, 24);
assert.deepEqual(empty.weeks.map(({ start, end }) => [start, end]), [
  ["2026-11-01", "2026-11-01"], ["2026-11-02", "2026-11-08"], ["2026-11-09", "2026-11-14"]
]);
assert.equal(empty.summary.completionRate, 0);
assert.equal(empty.summary.averageDrinksPerActiveDay, 0);
assert.deepEqual(empty.menus, []);
assert.equal(analyzeOrders([], { month: "2026-02", today: "2026-11-14" }).daily.length, 28);
assert.equal(analyzeOrders([], { month: "2024-02", today: "2026-11-14" }).daily.length, 29);
assert.equal(analyzeOrders([], { month: "2026-12", today: "2026-11-14" }).daily.length, 0);
assert.equal(analyzeOrders([], { month: "2026-13", today: "2026-11-14" }).daily.length, 0);

const orders = [
  { order_day: "2026-11-01", created_at: "2026-10-31T15:00:00Z", status: "done", party_size: "3", items: [{ name: "망고", quantity: "2" }, { name: "망고", quantity: 1 }] },
  { created_at: "2026-11-01T15:00:00Z", status: "making", party_size: 2, items: [{ name: "자몽", quantity: 2 }] },
  { order_day: "2026-11-02", created_at: "2026-11-02T06:30:00Z", status: "canceled", party_size: 8, items: [{ name: "취소 메뉴", quantity: 8 }] },
  { order_day: "2026-11-09", created_at: "2026-11-09T01:00:00Z", status: "new", party_size: 4, items: [{ name: "초코", quantity: 3 }, { name: "망고", quantity: 1 }] },
  { order_day: "2026-11-15", created_at: "2026-11-15T01:00:00Z", status: "done", party_size: 20, items: [{ name: "미래", quantity: 20 }] },
  { order_day: "2026-10-31", created_at: "2026-11-01T01:00:00Z", status: "done", party_size: 30, items: [{ name: "이전 달", quantity: 30 }] },
  { order_day: "2026-12-01", created_at: "2026-11-01T01:00:00Z", status: "done", party_size: 40, items: [{ name: "다음 달", quantity: 40 }] }
];
const result = analyzeOrders(orders, options);
assert.deepEqual({ ...result.summary, completionRate: 0 }, {
  orders: 4, validOrders: 3, drinks: 9, people: 9, active: 2, done: 1, canceled: 1,
  completionRate: 0, averageDrinksPerActiveDay: 3, orderingDays: 3
});
assert.ok(Math.abs(result.summary.completionRate - 100 / 3) < 1e-9);
assert.equal(result.daily[0].drinks, 3);
assert.equal(result.daily[1].orders, 1);
assert.equal(result.daily[1].canceled, 1);
assert.deepEqual(result.weekdays.map(({ label }) => label), ["월", "화", "수", "목", "금", "토", "일"]);
assert.equal(result.weekdays[0].drinks, 6);
assert.equal(result.weekdays[0].days, 2);
assert.equal(result.weekdays[0].averageDrinks, 3);
assert.equal(result.weeks[0].drinks, 3);
assert.equal(result.weeks[1].drinks, 2);
assert.equal(result.weeks[1].canceled, 1);
assert.equal(result.weeks[2].drinks, 4);
assert.equal(result.hours[0].drinks, 5);
assert.equal(result.hours[10].drinks, 4);
assert.deepEqual(result.menus.map(({ name, drinks, orders: count }) => [name, drinks, count]), [
  ["망고", 4, 2], ["초코", 3, 1], ["자몽", 2, 1]
]);
assert.equal(result.menus[0].share, 4 / 9 * 100);

for (const grouping of [result.daily, result.weekdays, result.weeks, result.hours, result.menus]) {
  assert.equal(grouping.reduce((sum, row) => sum + row.drinks, 0), result.summary.drinks);
}
for (const grouping of [result.daily, result.weekdays, result.weeks, result.hours]) {
  assert.equal(grouping.reduce((sum, row) => sum + row.orders, 0), result.summary.validOrders);
  assert.equal(grouping.reduce((sum, row) => sum + row.people, 0), result.summary.people);
}

const malformed = analyzeOrders([
  null,
  { order_day: "2026-11-01", created_at: "invalid", party_size: "oops", items: null, status: "done" },
  { order_day: "2026-02-30", created_at: "2026-11-02T15:30:00Z", party_size: "2", items: [null, { name: "초코", quantity: -1 }, { name: "초코", quantity: "NaN" }, { name: "초코", quantity: 1.5 }, { name: "초코", quantity: true }, { name: "초코", quantity: "2" }], status: "done" },
  { created_at: null, items: [], status: "done" },
  { order_day: "invalid", created_at: "invalid", status: "done", items: [{ quantity: 100 }] }
], options);
assert.equal(malformed.summary.orders, 2);
assert.equal(malformed.summary.drinks, 2);
assert.equal(malformed.summary.people, 2);
assert.equal(malformed.daily[2].drinks, 2);
assert.equal(malformed.hours[0].drinks, 2);
assert.equal(JSON.stringify(malformed).includes("null"), false);

const tied = analyzeOrders([
  { order_day: "2026-11-01", status: "done", items: [{ name: "자몽", quantity: 1 }, { name: "망고", quantity: 1 }] }
], options);
assert.deepEqual(tied.menus.map(({ name }) => name), ["망고", "자몽"]);
assert.equal(tied.menus.reduce((sum, menu) => sum + menu.share, 0), 100);

console.log("Detailed analytics: KST dates/hours, clipped weeks, weekday averages, cancellation exclusion, ranking, and totals passed.");
