export const activeOrderKey = "activeOrderId";
const activeOrderSnapshotKey = "activeOrderSnapshot";

export function orderLookupCode(order) {
  return order?.order_number == null ? "" : String(order.order_number % 1000).padStart(3, "0");
}

export function saveActiveOrder(storage, order) {
  try {
    storage.setItem(activeOrderKey, order.id);
    storage.setItem(activeOrderSnapshotKey, JSON.stringify(order));
    return true;
  } catch {
    return false;
  }
}

export function readActiveOrder(storage) {
  try {
    const order = JSON.parse(storage.getItem(activeOrderSnapshotKey));
    return order?.id ? order : null;
  } catch {
    return null;
  }
}

export function clearActiveOrder(storage) {
  try {
    storage.removeItem(activeOrderKey);
    storage.removeItem(activeOrderSnapshotKey);
  } catch {
    // Storage can be unavailable in private or embedded browsers.
  }
}
