export const activeOrderKey = "activeOrderId";
const activeOrderSnapshotKey = "activeOrderSnapshot";

export function orderLookupCode(order) {
  return String(order?.id || "").replaceAll("-", "").slice(0, 8).toUpperCase();
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
