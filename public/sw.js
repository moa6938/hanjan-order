const SCOPE_URL = new URL(self.registration.scope);
const CACHE_PREFIX = `hanjan-pwa-offline:${encodeURIComponent(SCOPE_URL.pathname)}:`;
const CACHE_NAME = `${CACHE_PREFIX}v1`;
const OFFLINE_PAGE = new URL("./offline.html", SCOPE_URL).href;
const ADMIN_URL = new URL("./#admin", SCOPE_URL).href;
const ICON_URL = new URL("./icon-192.png", SCOPE_URL).href;

function isInScope(value) {
  try {
    const url = new URL(value);
    return url.origin === SCOPE_URL.origin && url.pathname.startsWith(SCOPE_URL.pathname);
  } catch {
    return false;
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then(async (cache) => {
    // Never cache the authenticated application shell, orders, or API responses.
    const response = await fetch(OFFLINE_PAGE, { cache: "reload" });
    if (!response.ok || response.redirected || !response.headers.get("content-type")?.includes("text/html")) {
      throw new Error("Offline page unavailable");
    }
    await cache.put(OFFLINE_PAGE, response);
    await self.skipWaiting();
  }));
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((key) => key.startsWith(CACHE_PREFIX) && key !== CACHE_NAME).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET" || request.mode !== "navigate" || !isInScope(request.url)) return;
  event.respondWith(fetch(request).catch(async () => {
    const cache = await caches.open(CACHE_NAME);
    return await cache.match(OFFLINE_PAGE) || Response.error();
  }));
});

self.addEventListener("push", (event) => {
  let payload;
  try {
    payload = event.data?.json();
  } catch {
    // A malformed or empty message still needs a visible notification.
  }
  const text = (value, fallback, limit) => typeof value === "string" && value.trim()
    ? value.trim().slice(0, limit)
    : fallback;
  event.waitUntil(self.registration.showNotification(text(payload?.title, "새 음료 주문", 80), {
    body: text(payload?.body, "새 주문이 들어왔습니다. 주문 관리에서 확인해 주세요.", 240),
    icon: ICON_URL,
    badge: ICON_URL,
    tag: text(payload?.tag, "hanjan-order", 128),
    renotify: true,
    vibrate: [250, 100, 250, 100, 400],
    data: { url: ADMIN_URL }
  }));
});
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const existing = windows.find((client) => isInScope(client.url));
    if (existing) {
      try {
        const navigated = await existing.navigate(ADMIN_URL);
        return await (navigated || existing).focus();
      } catch {
        // If the existing window closed during navigation, open a fresh one.
      }
    }
    return self.clients.openWindow(ADMIN_URL);
  })());
});

