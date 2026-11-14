import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const root = new URL("../", import.meta.url);
const manifest = JSON.parse(readFileSync(new URL("public/manifest.webmanifest", root)));
assert.equal(manifest.id, "./admin");
assert.equal(manifest.start_url, "./#admin");
assert.equal(manifest.scope, "./");
assert.equal(manifest.display, "standalone");
for (const size of [192, 512]) {
  const icon = manifest.icons.find((icon) => icon.sizes === `${size}x${size}`);
  const png = readFileSync(new URL(`public/${icon.src.replace(/^\.\//, "")}`, root));
  assert.equal(png.readUInt32BE(16), size);
  assert.equal(png.readUInt32BE(20), size);
}

const handlers = {};
const stored = new Map();
const deleted = [];
const cache = { put: async (key, response) => stored.set(key, response), match: async (key) => stored.get(key) };
let offline = false;
let redirected = false;
let claimed = false;
const notifications = [];
const opened = [];
let windows = [];
const context = vm.createContext({
  URL, Response,
  self: {
    location: { origin: "https://test.example" },
    addEventListener: (name, handler) => { handlers[name] = handler; },
    skipWaiting: async () => {},
    registration: { scope: "https://test.example/hanjan-order/", showNotification: async (title, options) => { notifications.push({ title, options }); } },
    clients: {
      claim: async () => { claimed = true; },
      matchAll: async (options) => {
        assert.equal(options.type, "window");
        assert.equal(options.includeUncontrolled, true);
        return windows;
      },
      openWindow: async (url) => { opened.push(url); }
    }
  },
  caches: {
    open: async () => cache,
    keys: async () => ["unrelated-cache", "hanjan-pwa-offline:%2Fanother-app%2F:v0", "hanjan-pwa-offline:%2Fhanjan-order%2F:v0", "hanjan-pwa-offline:%2Fhanjan-order%2F:v1"],
    delete: async (key) => { deleted.push(key); }
  },
  fetch: async (url) => {
    if (offline) throw new Error("Offline");
    const response = new Response(url === "https://test.example/hanjan-order/offline.html" ? "Offline notice" : "Network page", { headers: { "content-type": "text/html" } });
    if (redirected) Object.defineProperty(response, "redirected", { value: true });
    return response;
  }
});
vm.runInContext(readFileSync(new URL("public/sw.js", root), "utf8"), context);
let pending;
handlers.install({ waitUntil: (promise) => { pending = promise; } });
await pending;
assert.deepEqual([...stored.keys()], ["https://test.example/hanjan-order/offline.html"]);
redirected = true;
handlers.install({ waitUntil: (promise) => { pending = promise; } });
await assert.rejects(pending, /Offline page unavailable/);
redirected = false;
handlers.activate({ waitUntil: (promise) => { pending = promise; } });
await pending;
assert.equal(claimed, true);
assert.deepEqual(deleted, ["hanjan-pwa-offline:%2Fhanjan-order%2F:v0"]);

async function request(url, mode = "navigate", method = "GET") {
  let response;
  handlers.fetch({ request: { url, mode, method }, respondWith: (promise) => { response = promise; } });
  return response && await response;
}
assert.equal(await (await request("https://test.example/hanjan-order/")).text(), "Network page");
assert.equal(await request("https://test.example/orders", "cors", "POST"), undefined);
assert.equal(await request("https://test.example/orders", "cors"), undefined);
assert.equal(await request("https://database.example/orders"), undefined);
assert.equal(await request("https://test.example/another-app/"), undefined);
assert.equal(await request("https://test.example/hanjan-order-other/"), undefined);
offline = true;
assert.equal(await (await request("https://test.example/hanjan-order/")).text(), "Offline notice");
assert.deepEqual([...stored.keys()], ["https://test.example/hanjan-order/offline.html"], "Only the offline notice is cached");

async function push(data) {
  handlers.push({ data, waitUntil: (promise) => { pending = promise; } });
  await pending;
  return notifications.at(-1);
}
const normal = await push({ json: () => ({ title: "새 주문", body: "총 2잔", tag: "order-123", url: "https://evil.example/" }) });
assert.equal(normal.title, "새 주문");
assert.equal(normal.options.body, "총 2잔");
assert.equal(normal.options.tag, "order-123");
assert.equal(normal.options.icon, "https://test.example/hanjan-order/icon-192.png");
assert.equal(normal.options.badge, "https://test.example/hanjan-order/icon-192.png");
assert.equal(normal.options.renotify, true);
assert.ok(normal.options.vibrate.length > 0);
assert.equal(normal.options.data.url, "https://test.example/hanjan-order/#admin");
const malformed = await push({ json: () => { throw new SyntaxError("Invalid JSON"); } });
assert.equal(malformed.title, "새 음료 주문");
assert.ok(malformed.options.body.length > 0);
const empty = await push(undefined);
assert.equal(empty.title, "새 음료 주문");
assert.equal(empty.options.tag, "hanjan-order");
for (const value of [null, [], "text", 17, { title: {}, body: 123, tag: [] }]) {
  const notification = await push({ json: () => value });
  assert.equal(notification.title, "새 음료 주문");
  assert.equal(notification.options.tag, "hanjan-order");
}
const bounded = await push({ json: () => ({ title: "a".repeat(200), body: "b".repeat(500), tag: "c".repeat(200) }) });
assert.equal(bounded.title.length, 80);
assert.equal(bounded.options.body.length, 240);
assert.equal(bounded.options.tag.length, 128);

let closed = 0;
async function click() {
  handlers.notificationclick({
    notification: { data: { url: "https://evil.example/" }, close: () => { closed++; } },
    waitUntil: (promise) => { pending = promise; }
  });
  await pending;
}
let focused = 0;
const navigated = [];
const external = { url: "https://evil.example/", navigate: async () => { throw new Error("External window must not be touched"); } };
const existing = {
  url: "https://test.example/hanjan-order/#order",
  navigate: async (url) => { navigated.push(url); return { focus: async () => { focused++; } }; },
  focus: async () => { throw new Error("Prefer the navigated client"); }
};
windows = [external, { url: "invalid-url" }, existing];
await click();
assert.equal(closed, 1);
assert.deepEqual(navigated, ["https://test.example/hanjan-order/#admin"]);
assert.equal(focused, 1);
assert.deepEqual(opened, []);
const otherApp = { url: "https://test.example/another-app/", navigate: async () => { throw new Error("Other app must not be touched"); } };
windows = [external, otherApp];
await click();
assert.deepEqual(opened, ["https://test.example/hanjan-order/#admin"]);
windows = [{ url: "https://test.example/hanjan-order/", navigate: async () => { throw new Error("Window closed"); } }];
await click();
assert.equal(opened.length, 2);
assert.equal(opened[1], "https://test.example/hanjan-order/#admin");
console.log("PWA subpath scope, manifest/icons, isolated offline cache, safe push fallbacks, and notification navigation passed.");

