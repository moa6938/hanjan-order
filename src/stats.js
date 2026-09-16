export function summarizeOrders(orders, day) {
  const today = orders.filter((order) => order.order_day === day);
  const served = today.filter((order) => order.status !== "canceled");
  const menuCounts = new Map();
  let drinks = 0;

  served.forEach((order) => {
    order.items.forEach((item) => {
      drinks += item.quantity;
      menuCounts.set(item.name, (menuCounts.get(item.name) || 0) + item.quantity);
    });
  });

  return {
    orders: today.length,
    drinks,
    active: today.filter((order) => ["new", "making"].includes(order.status)).length,
    done: today.filter((order) => order.status === "done").length,
    canceled: today.filter((order) => order.status === "canceled").length,
    popular: [...menuCounts].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0], "ko")).slice(0, 5)
  };
}
