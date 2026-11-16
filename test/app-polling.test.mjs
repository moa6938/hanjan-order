import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import * as orderStorage from "../src/order-storage.js";
import { analyzeOrders, ordersToCsv } from "../src/stats.js";
import { loadMonthlyOrders } from "../src/stats-data.js";

const appSource = readFileSync(new URL("../src/app.js", import.meta.url), "utf8")
  .replace(/^import .*;\r?\n/gm, "");
const pollerSource = readFileSync(new URL("../src/polling.js", import.meta.url), "utf8")
  .replace("export function createPoller", "function createPoller");
const flush = async () => { for (let count = 0; count < 30; count++) await Promise.resolve(); };
const fixedTime = Date.parse("2026-11-16T01:00:00Z");

class Element {
  constructor(id = "") {
    this.id = id;
    this.hidden = false;
    this.disabled = false;
    this.value = "";
    this.textContent = "";
    this.dataset = {};
    this.attributes = new Map();
    this.listeners = new Map();
    this.descendants = new Map();
    this.children = [];
    this.lastChild = { textContent: "" };
    const classes = new Set();
    this.classList = {
      add: (...names) => names.forEach((name) => classes.add(name)),
      remove: (...names) => names.forEach((name) => classes.delete(name)),
      toggle: (name, enabled = !classes.has(name)) => enabled ? classes.add(name) : classes.delete(name)
    };
  }
  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, new Set());
    this.listeners.get(name).add(listener);
  }
  removeEventListener(name, listener) { this.listeners.get(name)?.delete(listener); }
  async emit(name) {
    await Promise.all([...(this.listeners.get(name) || [])].map((listener) => listener({
      preventDefault() {}, target: this
    })));
    await flush();
  }
  querySelector(selector) {
    if (!this.descendants.has(selector)) this.descendants.set(selector, new Element(selector));
    return this.descendants.get(selector);
  }
  querySelectorAll(selector) { return selector === "button" ? [this.querySelector("plus"), this.querySelector("minus")] : []; }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name) ?? null; }
  scrollIntoView() {}
  select() {}
  remove() {}
  click() { return this.emit("click"); }
  cloneNode() { return new Element(this.id); }
}

function storage(seed = {}) {
  const values = new Map(Object.entries(seed));
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => values.set(key, String(value)),
    removeItem: (key) => values.delete(key)
  };
}

function sampleOrder(status = "new", sequence = 1) {
  return {
    id: `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`,
    order_number: sequence,
    order_day: "2026-11-16",
    created_at: "2026-11-16T00:00:00Z",
    customer_name: "통합 테스트",
    party_size: 1,
    status,
    items: [{ name: "테스트 음료", quantity: 1 }]
  };
}

async function fixture(options = {}) {
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const tabs = ["orders", "menu", "stats"].map((name) => {
    const tab = element(`${name}-tab`);
    tab.dataset.adminTab = name;
    tab.setAttribute("aria-selected", name === "orders");
    return tab;
  });
  const panels = ["orders", "menu", "stats"].map((name) => element(`${name}-panel`));
  const categories = ["ADE", "NON SODA"].map((name) => {
    const tab = new Element(name);
    tab.dataset.menuCategory = name;
    return tab;
  });
  for (const id of ["order-view", "admin-view", "order-form", "ticket", "admin-dashboard", "menu-panel", "stats-panel"]) element(id).hidden = true;
  element("party-size").value = "1";
  element("menu-template").content = { firstElementChild: new Element("menu-card") };
  const document = Object.assign(new Element("document"), {
    hidden: Boolean(options.hidden), cookie: "", body: new Element("body"),
    querySelector: (selector) => element(selector.replace(/^#/, "")),
    querySelectorAll: (selector) => selector === "[data-admin-tab]" ? tabs : selector === ".admin-panel" ? panels : selector === "[data-menu-category]" ? categories : [],
    createElement: (tag) => new Element(tag)
  });
  const navigator = { onLine: options.online !== false, clipboard: { async writeText() {} } };
  const window = Object.assign(new Element("window"), { navigator });
  const state = { orders: [], customerOrder: options.customerOrder ?? null, failStats: false, chimes: 0, pushSetups: 0 };
  const calls = [];
  let now = 0;
  let nextTimer = 1;
  const timers = new Map();
  function schedule(callback, delay, repeat = false) {
    const id = nextTimer++;
    timers.set(id, { callback, delay, repeat, at: now + delay });
    return id;
  }
  const supabase = {
    rpc(name, parameters) {
      calls.push({ name, parameters, at: now });
      let result;
      if (name === "admin_check_pin") result = { data: true, error: null };
      else if (name === "admin_list_orders") result = { data: state.orders, error: null };
      else if (name === "admin_list_orders_by_month") result = state.failStats
        ? { data: null, error: new Error("fixture statistics outage") }
        : { data: state.orders, error: null };
      else if (name === "list_menu_items") result = { data: [], error: null };
      else if (name === "get_order") result = { data: state.customerOrder, error: null };
      else throw new Error(`Unexpected RPC: ${name}`);
      return Object.assign(Promise.resolve(result), {
        maybeSingle: async () => result,
        single: async () => result,
        range: async () => result
      });
    }
  };
  const seed = options.customerOrder ? {
    activeOrderId: options.customerOrder.id,
    activeOrderSnapshot: JSON.stringify(options.customerOrder)
  } : options.seedId ? { activeOrderId: options.seedId } : {};
  const localStorage = storage(seed);
  class FixedDate extends Date {
    constructor(...args) { super(...(args.length ? args : [fixedTime + now])); }
    static now() { return fixedTime + now; }
  }
  const context = vm.createContext({
    ...orderStorage, analyzeOrders, ordersToCsv, loadMonthlyOrders,
    document, window, navigator, localStorage, sessionStorage: storage(),
    location: { hash: options.customer ? "#order" : "#admin", pathname: "/hanjan-order/", origin: "https://fixture.example" },
    Date: FixedDate, Intl, URL, Blob,
    console: { error() {} },
    crypto: { randomUUID: () => "00000000-0000-4000-8000-000000000099" },
    Audio: class { async play() { state.chimes++; } },
    QRCode: { async toDataURL() { return "data:image/png;base64,fixture"; } },
    createClient: () => supabase,
    createStatsView: () => ({ render() {} }),
    setupPush: () => { state.pushSetups++; },
    reorderedMenuIds: (items) => items,
    confirm: () => false,
    alert() {},
    setTimeout: (callback, delay) => schedule(callback, delay),
    clearTimeout: (id) => timers.delete(id),
    setInterval: (callback, delay) => schedule(callback, delay, true),
    clearInterval: (id) => timers.delete(id)
  });
  vm.runInContext(`${pollerSource}\n${appSource}`, context);
  await flush();
  return {
    state, document, window, navigator, localStorage, calls, element,
    count: (name) => calls.filter((call) => call.name === name).length,
    async login() {
      element("admin-pin").value = "fixture-pin";
      await element("admin-login").emit("submit");
    },
    async tab(name) { await element(`${name}-tab`).emit("click"); },
    async advance(milliseconds) {
      const end = now + milliseconds;
      let iterations = 0;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        assert.ok(++iterations < 200, "App refreshes must not enter a hot loop");
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        if (next[1].repeat) timers.set(next[0], { ...next[1], at: now + next[1].delay });
        await flush();
      }
      now = end;
      await flush();
    }
  };
}

{
  const f = await fixture();
  await f.login();
  assert.equal(f.count("admin_list_orders"), 1);
  assert.equal(f.count("list_menu_items"), 0, "The initial orders panel must not load hidden menu data");
  assert.equal(f.count("admin_list_orders_by_month"), 0, "The initial orders panel must not load hidden monthly data");
  assert.equal(f.state.pushSetups, 1, "Push setup remains independent of polling panels");
  await f.advance(5000);
  assert.equal(f.count("admin_list_orders"), 3, "Foreground order updates retain the 2.5-second cadence");
  await f.element("audio-button").emit("click");
  const initialChimes = f.state.chimes;
  f.state.orders = [sampleOrder()];
  await f.advance(2500);
  assert.equal(f.state.chimes, initialChimes + 1, "A newly arriving order still rings once");
  await f.advance(2500);
  assert.equal(f.state.chimes, initialChimes + 1, "The same order must not ring repeatedly");
  await f.tab("menu");
  assert.equal(f.count("list_menu_items"), 1, "Opening menus fetches immediately");
  await f.advance(5000);
  assert.equal(f.count("list_menu_items"), 2);
  await f.tab("stats");
  const menuCalls = f.count("list_menu_items");
  assert.equal(f.count("admin_list_orders_by_month"), 1, "Opening statistics fetches immediately");
  await f.advance(30000);
  assert.equal(f.count("list_menu_items"), menuCalls, "Leaving menus stops automatic menu reads");
  assert.equal(f.count("admin_list_orders_by_month"), 2);
  await f.tab("orders");
  const statsCalls = f.count("admin_list_orders_by_month");
  await f.advance(30000);
  assert.equal(f.count("admin_list_orders_by_month"), statsCalls, "Leaving statistics stops automatic monthly reads");
}

{
  const f = await fixture();
  await f.login();
  f.document.hidden = true;
  await f.document.emit("visibilitychange");
  const hiddenCalls = f.calls.length;
  await f.advance(60000);
  assert.equal(f.calls.length, hiddenCalls, "Hidden admin pages must send no recurring RPCs");
  f.document.hidden = false;
  await f.document.emit("visibilitychange");
  assert.equal(f.calls.length, hiddenCalls + 1, "Visible admin pages refresh orders immediately");
  f.navigator.onLine = false;
  await f.window.emit("offline");
  const offlineCalls = f.calls.length;
  await f.advance(60000);
  assert.equal(f.calls.length, offlineCalls, "Offline admin pages must send no recurring RPCs");
  f.navigator.onLine = true;
  await f.window.emit("online");
  assert.equal(f.calls.length, offlineCalls + 1, "Online recovery refreshes orders immediately");
  assert.equal(f.state.pushSetups, 1, "Pausing page requests must leave the existing push setup intact");
  f.state.failStats = true;
  await f.tab("stats");
  const ordersBeforeFailure = f.count("admin_list_orders");
  assert.equal(f.element("stats-message").hidden, false);
  await f.advance(5000);
  assert.equal(f.count("admin_list_orders"), ordersBeforeFailure + 2, "A statistics outage must not stop order polling");
}

{
  const f = await fixture({ customer: true, customerOrder: sampleOrder("new") });
  assert.equal(f.count("get_order"), 1, "The cached customer ticket is verified immediately");
  const initialMenuCalls = f.count("list_menu_items");
  f.state.customerOrder = sampleOrder("done");
  await f.advance(2500);
  assert.equal(f.element("ticket-status").textContent, "완료");
  const completedCalls = f.count("get_order");
  await f.advance(60000);
  assert.equal(f.count("get_order"), completedCalls, "Completed orders must stop status polling");
  assert.equal(f.count("list_menu_items"), initialMenuCalls, "A ticket with hidden menus must not poll menus");
  assert.equal(f.element("ticket").hidden, false, "Stopping requests must preserve the visible ticket");
  await f.element("new-order-button").emit("click");
  assert.equal(f.count("list_menu_items"), initialMenuCalls + 1, "Opening the menu refreshes it immediately");
  await f.advance(5000);
  assert.equal(f.count("list_menu_items"), initialMenuCalls + 2);
}

{
  const f = await fixture({ customer: true, customerOrder: sampleOrder("new") });
  f.state.customerOrder = null;
  await f.advance(2500);
  assert.equal(f.localStorage.getItem("activeOrderId"), null, "A missing order clears its stale storage ID");
  const calls = f.count("get_order");
  await f.advance(60000);
  assert.equal(f.count("get_order"), calls, "Missing orders must stop status polling");
  const corrupted = await fixture({ customer: true, seedId: "null" });
  await corrupted.advance(10000);
  assert.equal(corrupted.count("get_order"), 0, "Corrupt remembered IDs must never reach the database");
}

{
  const f = await fixture({ customer: true, customerOrder: sampleOrder("canceled") });
  assert.equal(f.element("ticket-status").textContent, "취소됨");
  assert.equal(f.count("get_order"), 1, "A restored canceled ticket is verified once");
  await f.advance(60000);
  assert.equal(f.count("get_order"), 1, "Canceled tickets must not continue polling");
}

console.log("App polling: active panels only, foreground chime cadence, hidden/offline resume, isolated stats failures, and completed/missing ticket cleanup passed.");
