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
