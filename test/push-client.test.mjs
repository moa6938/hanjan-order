import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/push.js", import.meta.url), "utf8")
  .replace(/^import .*;\n/m, "")
  .replace("export function setupPush", "function setupPush");
const bytes = Uint8Array.from({ length: 65 }, (_, index) => index === 0 ? 4 : index);
const publicKey = Buffer.from(bytes).toString("base64url");
const endpoint = "https://fcm.googleapis.com/fcm/send/this-tablet";

function fixture(options = {}) {
  const calls = [];
  const buttons = Object.fromEntries(["enable", "test", "disable"].map((name) => [name, {
    hidden: name !== "enable", disabled: false, dataset: {}, listeners: {},
    addEventListener(event, callback) { this.listeners[event] = callback; }
  }]));
  const status = { textContent: "" };
  const state = { subscription: null, permission: options.permission || "default", delivered: 1 };
  function subscription() {
    return {
      endpoint,
      options: { applicationServerKey: bytes.buffer },
      toJSON: () => ({ endpoint, keys: { p256dh: "public-key", auth: "auth-key" } }),
      async unsubscribe() {
        calls.push({ name: "unsubscribe", endpoint });
        state.subscription = null;
        return true;
      }
    };
  }
  if (options.existing) state.subscription = subscription();
  const notification = {
    get permission() { return state.permission; },
    async requestPermission() {
      calls.push({ name: "permission" });
      state.permission = options.permissionResult || "granted";
      return state.permission;
    }
  };
  const worker = {
    pushManager: {
      async getSubscription() { return state.subscription; },
      async subscribe(params) {
        calls.push({ name: "subscribe", params });
        state.subscription = subscription();
        return state.subscription;
      }
    }
  };
  const supabase = {
    async rpc(name, params) {
      calls.push({ name, params });
      if (name === "hanjan_push_register" && options.failRegistration) return { error: { code: "42501" } };
      return { data: name === "hanjan_push_status" ? Boolean(options.saved) : true, error: null };
    }
  };
  const context = vm.createContext({
    Uint8Array, atob, setTimeout, clearTimeout, AbortSignal,
    window: { isSecureContext: true, PushManager: function () {}, Notification: notification },
    navigator: { serviceWorker: {} },
    Notification: notification,
    workerReady: Promise.resolve(worker),
    document: { querySelector: (selector) => selector === "#push-status" ? status : buttons[selector.replace("#push-", "")] },
    async fetch(url, params) {
      calls.push({ name: params.method === "POST" ? "sendTest" : "config", url, params });
      return { ok: true, status: 200, json: async () => params.method === "POST" ? { delivered: state.delivered, failed: 0 } : { publicKey } };
    }
  });
  vm.runInContext(source, context);
  context.setupPush({ supabase, pin: "1357", backendUrl: "https://db.example", apiKey: "publishable-test-key" });
  async function idle() {
    for (let count = 0; count < 30 && Object.values(buttons).some((button) => button.disabled); count++) {
      await new Promise(setImmediate);
    }
    assert.ok(Object.values(buttons).every((button) => !button.disabled), "Controls recover after the asynchronous action");
  }
  async function click(name) {
    assert.equal(buttons[name].hidden, false, `${name} control is visible before it is clicked`);
    buttons[name].listeners.click();
    await idle();
  }
  return { calls, buttons, status, state, idle, click };
}

const fresh = fixture();
await fresh.idle();
assert.equal(fresh.buttons.enable.hidden, false);
assert.equal(fresh.buttons.test.hidden, true);
assert.equal(fresh.buttons.disable.hidden, true);
assert.equal(fresh.calls.length, 0, "Opening the page does not prompt, subscribe, or claim registration");
await fresh.click("enable");
assert.deepEqual(fresh.calls.map((call) => call.name), ["permission", "config", "subscribe", "hanjan_push_register"]);
const configuration = fresh.calls.find((call) => call.name === "config");
assert.equal(configuration.url, "https://db.example/functions/v1/hanjan-push");
assert.equal(configuration.params.headers.apikey, "publishable-test-key");
const subscribe = fresh.calls.find((call) => call.name === "subscribe");
assert.equal(subscribe.params.userVisibleOnly, true);
assert.deepEqual(Array.from(subscribe.params.applicationServerKey), Array.from(bytes));
const registered = fresh.calls.find((call) => call.name === "hanjan_push_register");
assert.equal(registered.params.pin, "1357");
assert.equal(registered.params.push_subscription.endpoint, endpoint);
assert.equal(fresh.buttons.enable.hidden, true);
assert.equal(fresh.buttons.test.hidden, false);
assert.equal(fresh.buttons.disable.hidden, false);

await fresh.click("test");
let testRequest = fresh.calls.filter((call) => call.name === "sendTest").at(-1);
assert.deepEqual(JSON.parse(testRequest.params.body), { action: "test", pin: "1357", endpoint });
assert.match(fresh.status.textContent, /이 기기로 테스트 알림을 전송했어요/);
fresh.state.delivered = 0;
await fresh.click("test");
assert.match(fresh.status.textContent, /알림이 전송되지 않았어요/);
assert.doesNotMatch(fresh.status.textContent, /알림을 전송했어요/);
await fresh.click("disable");
const removed = fresh.calls.find((call) => call.name === "hanjan_push_unregister");
assert.equal(removed.params.pin, "1357");
assert.equal(removed.params.subscription_endpoint, endpoint);
assert.deepEqual(Object.keys(removed.params).sort(), ["pin", "subscription_endpoint"]);
assert.equal(fresh.calls.filter((call) => call.name === "unsubscribe").length, 1);
assert.equal(fresh.buttons.enable.hidden, false);
assert.equal(fresh.buttons.test.hidden, true);
assert.equal(fresh.state.subscription, null);

const failed = fixture({ failRegistration: true });
await failed.idle();
await failed.click("enable");
assert.deepEqual(failed.calls.map((call) => call.name), ["permission", "config", "subscribe", "hanjan_push_register", "unsubscribe"]);
assert.equal(failed.state.subscription, null, "An unsaved newly created subscription is rolled back");
assert.equal(failed.buttons.enable.hidden, false);
assert.equal(failed.buttons.test.hidden, true);
assert.match(failed.status.textContent, /관리자 비밀번호를 다시 확인/);

const denied = fixture({ permissionResult: "denied" });
await denied.idle();
await denied.click("enable");
assert.deepEqual(denied.calls.map((call) => call.name), ["permission"]);
assert.equal(denied.state.subscription, null);
assert.equal(denied.buttons.enable.hidden, false);
assert.match(denied.status.textContent, /알림을 허용/);

const unsaved = fixture({ existing: true, permission: "granted", saved: false });
await unsaved.idle();
assert.equal(unsaved.buttons.enable.hidden, false, "Browser subscription alone does not mean the server registered it");
assert.equal(unsaved.buttons.test.hidden, true);
assert.equal(unsaved.calls[0].name, "hanjan_push_status");
assert.equal(unsaved.calls[0].params.subscription_endpoint, endpoint);

const saved = fixture({ existing: true, permission: "granted", saved: true });
await saved.idle();
assert.equal(saved.buttons.enable.hidden, true);
assert.equal(saved.buttons.test.hidden, false);
assert.equal(saved.calls.length, 1, "An existing server registration is checked without asking permission or resubscribing");

console.log("Push client registration, rollback, permission denial, targeted test delivery, and device-only disable passed.");
