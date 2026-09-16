import assert from "node:assert/strict";
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
  note: "얼음 \"조금\"",
  status: "done"
}]);

assert.equal(csv, '"주문번호","주문일시","주문자","인원수","주문메뉴","요청사항","상태"\r\n"A026","2026-09-16 17:30","\'=테스트","3명","망고, 에이드 2잔 / 자몽 1잔","얼음 ""조금""","완료"');

console.log("csv test passed");
