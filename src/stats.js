export function summarizeOrders(orders) {
  const served = orders.filter((order) => order.status !== "canceled");
  const menuCounts = new Map();
  let drinks = 0;

  served.forEach((order) => {
    order.items.forEach((item) => {
      drinks += item.quantity;
      menuCounts.set(item.name, (menuCounts.get(item.name) || 0) + item.quantity);
    });
  });

  return {
    orders: orders.length,
    drinks,
    active: orders.filter((order) => ["new", "making"].includes(order.status)).length,
    done: orders.filter((order) => order.status === "done").length,
    canceled: orders.filter((order) => order.status === "canceled").length,
    popular: [...menuCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).slice(0, 5)
  };
}

const csvStatuses = { new: "접수 대기", making: "제조 중", done: "완료", canceled: "취소됨" };

function csvCell(value) {
  const safe = String(value ?? "").replace(/^\s*([=+\-@])/, "'$&");
  return `"${safe.replaceAll('"', '""')}"`;
}

export function ordersToCsv(orders) {
  const header = ["주문번호", "주문일시", "주문자", "인원수", "주문메뉴", "요청사항", "상태"];
  const dateTime = new Intl.DateTimeFormat("sv-SE", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  });
  const rows = orders.map((order) => [
    `A${String(order.order_number).padStart(3, "0")}`,
    dateTime.format(new Date(order.created_at)),
    order.customer_name,
    `${order.party_size}명`,
    order.items.map((item) => `${item.name} ${item.quantity}잔`).join(" / "),
    order.note,
    csvStatuses[order.status] || order.status
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
