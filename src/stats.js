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

const seoulDateTime = new Intl.DateTimeFormat("en-US", {
  timeZone: "Asia/Seoul",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  hourCycle: "h23"
});
const weekdayLabels = ["월", "화", "수", "목", "금", "토", "일"];

function isCalendarDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function positiveCount(value) {
  if (typeof value !== "number" && typeof value !== "string") return 0;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : 0;
}

function seoulTimestamp(value) {
  if (typeof value !== "string" || !value.trim()) return null;
  const timestamp = new Date(value);
  if (!Number.isFinite(timestamp.getTime())) return null;
  const parts = Object.fromEntries(seoulDateTime.formatToParts(timestamp).map(({ type, value: part }) => [type, part]));
  return { date: `${parts.year}-${parts.month}-${parts.day}`, hour: Number(parts.hour) };
}

export function analyzeOrders(orders, { month, today } = {}) {
  const summary = {
    orders: 0, validOrders: 0, drinks: 0, people: 0, active: 0, done: 0, canceled: 0,
    completionRate: 0, averageDrinksPerActiveDay: 0, orderingDays: 0
  };
  const daily = [];
  const weekdays = weekdayLabels.map((label, weekday) => ({ weekday, label, days: 0, orders: 0, drinks: 0, people: 0, averageDrinks: 0 }));
  const weeks = [];
  const hours = Array.from({ length: 24 }, (_, hour) => ({ hour, label: `${hour}시`, orders: 0, drinks: 0, people: 0 }));
  const empty = { summary, daily, weekdays, weeks, hours, menus: [] };
  if (typeof month !== "string" || !/^\d{4}-\d{2}$/.test(month) || !isCalendarDate(`${month}-01`) || !isCalendarDate(today)) return empty;

  const start = `${month}-01`;
  if (start > today) return empty;
  const cursor = new Date(`${start}T00:00:00Z`);
  const daysByDate = new Map();
  const weeksByDate = new Map();
  let week;
  while (cursor.toISOString().slice(0, 7) === month) {
    const date = cursor.toISOString().slice(0, 10);
    if (date > today) break;
    const weekday = (cursor.getUTCDay() + 6) % 7;
    const day = { date, label: `${cursor.getUTCDate()}일`, orders: 0, drinks: 0, people: 0, canceled: 0 };
    daily.push(day);
    daysByDate.set(date, day);
    weekdays[weekday].days++;
    if (!week || weekday === 0) {
      week = { start: date, end: date, orders: 0, drinks: 0, people: 0, canceled: 0 };
      weeks.push(week);
    }
    week.end = date;
    weeksByDate.set(date, week);
    cursor.setUTCDate(cursor.getUTCDate() + 1);
  }

  const menuCounts = new Map();
  for (const order of Array.isArray(orders) ? orders : []) {
    if (!order || typeof order !== "object") continue;
    const timestamp = seoulTimestamp(order.created_at);
    const date = isCalendarDate(order.order_day) ? order.order_day : timestamp?.date;
    const day = daysByDate.get(date);
    if (!day) continue;
    const dateValue = new Date(`${date}T00:00:00Z`);
    const weekday = weekdays[(dateValue.getUTCDay() + 6) % 7];
    const weekRow = weeksByDate.get(date);
    summary.orders++;
    if (order.status === "canceled") {
      summary.canceled++;
      day.canceled++;
      weekRow.canceled++;
      continue;
    }

    summary.validOrders++;
    if (order.status === "done") summary.done++;
    if (["new", "making"].includes(order.status)) summary.active++;
    const people = positiveCount(order.party_size);
    let drinks = 0;
    const menusInOrder = new Set();
    for (const item of Array.isArray(order.items) ? order.items : []) {
      const quantity = positiveCount(item?.quantity);
      if (!quantity) continue;
      const name = typeof item.name === "string" && item.name.trim() ? item.name.trim() : "이름 없는 메뉴";
      drinks += quantity;
      const menu = menuCounts.get(name) || { name, drinks: 0, orders: 0, share: 0 };
      menu.drinks += quantity;
      if (!menusInOrder.has(name)) menu.orders++;
      menusInOrder.add(name);
      menuCounts.set(name, menu);
    }
    summary.drinks += drinks;
    summary.people += people;
    const rows = [day, weekday, weekRow];
    if (timestamp) rows.push(hours[timestamp.hour]);
    for (const row of rows) {
      row.orders++;
      row.drinks += drinks;
      row.people += people;
    }
  }

  summary.orderingDays = daily.filter((day) => day.orders > 0).length;
  summary.completionRate = summary.validOrders ? summary.done / summary.validOrders * 100 : 0;
  summary.averageDrinksPerActiveDay = summary.orderingDays ? summary.drinks / summary.orderingDays : 0;
  weekdays.forEach((day) => { day.averageDrinks = day.days ? day.drinks / day.days : 0; });
  const menus = [...menuCounts.values()].sort((a, b) => b.drinks - a.drinks || a.name.localeCompare(b.name, "ko"));
  menus.forEach((menu) => { menu.share = summary.drinks ? menu.drinks / summary.drinks * 100 : 0; });
  return { summary, daily, weekdays, weeks, hours, menus };
}

const csvStatuses = { new: "접수 대기", making: "제조 중", done: "완료", canceled: "취소됨" };

function csvCell(value) {
  const safe = String(value ?? "").replace(/^\s*([=+\-@])/, "'$&");
  return `"${safe.replaceAll('"', '""')}"`;
}

export function ordersToCsv(orders) {
  const header = ["주문번호", "주문일시", "주문자", "인원수", "주문메뉴", "상태"];
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
    csvStatuses[order.status] || order.status
  ]);
  return [header, ...rows].map((row) => row.map(csvCell).join(",")).join("\r\n");
}
