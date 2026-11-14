export const activeOrderKey = "activeOrderId";
const activeOrderSnapshotKey = "activeOrderSnapshot";

export function isOrderId(value) {
  return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
}

export function readActiveOrderId(storages, cookie = "") {
  for (const storage of storages) {
    try {
      const id = storage.getItem(activeOrderKey);
      if (isOrderId(id)) return id;
    } catch {
      // Continue with the next available storage.
    }
  }
  try {
    const encoded = cookie.match(new RegExp(`(?:^|; )${activeOrderKey}=([^;]*)`))?.[1];
    const id = encoded ? decodeURIComponent(encoded) : null;
    return isOrderId(id) ? id : null;
  } catch {
    return null;
  }
}

export function orderLookupCode(order) {
  return order?.order_number == null ? "" : String(order.order_number % 1000).padStart(3, "0");
}

export function saveActiveOrder(storage, order) {
  if (!isOrderId(order?.id)) return false;
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
    return isOrderId(order?.id) ? order : null;
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
