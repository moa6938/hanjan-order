export async function loadMonthlyOrders(supabase, pin, month) {
  if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new Error("조회할 달을 선택해 주세요.");
  const pageSize = 500;
  const orders = new Map();
  for (let offset = 0; ; offset += pageSize) {
    const { data, error } = await supabase.rpc("admin_list_orders_by_month", {
      pin, selected_month: `${month}-01`
    }).range(offset, offset + pageSize - 1);
    if (error) throw error;
    if (!Array.isArray(data)) throw new Error("주문 내역을 불러오지 못했습니다.");
    data.forEach((order) => orders.set(order.id, order));
    if (data.length < pageSize) return [...orders.values()];
  }
}
