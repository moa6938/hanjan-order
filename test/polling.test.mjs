import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const source = readFileSync(new URL("../src/polling.js", import.meta.url), "utf8")
  .replace("export function createPoller", "function createPoller");
const flush = async () => { for (let count = 0; count < 12; count++) await Promise.resolve(); };

function eventTarget(state = {}) {
  const listeners = new Map();
  return Object.assign(state, {
    addEventListener(name, listener) {
      if (!listeners.has(name)) listeners.set(name, new Set());
      listeners.get(name).add(listener);
    },
    removeEventListener(name, listener) { listeners.get(name)?.delete(listener); },
    dispatch(name) { for (const listener of listeners.get(name) || []) listener(); },
    listenerCount() { return [...listeners.values()].reduce((sum, group) => sum + group.size, 0); }
  });
}

function fixture(options = {}) {
  const pageDocument = eventTarget({ hidden: Boolean(options.hidden) });
  const pageWindow = eventTarget({ navigator: { onLine: options.online !== false } });
  const timers = new Map();
  let now = 0;
  let nextId = 1;
  const context = vm.createContext({
    document: pageDocument,
    window: pageWindow,
    setTimeout(callback, delay) {
      const id = nextId++;
      timers.set(id, { callback, at: now + delay });
      return id;
    },
    clearTimeout(id) { timers.delete(id); }
  });
  vm.runInContext(source, context);
  return {
    pageDocument, pageWindow, timers,
    poller: (run, settings = {}) => context.createPoller(run, { interval: 1000, ...settings }),
    async advance(milliseconds) {
      const end = now + milliseconds;
      let iterations = 0;
      while (true) {
        const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0];
        if (!next || next[1].at > end) break;
        assert.ok(++iterations < 100, "Polling must not enter a zero-delay loop");
        now = next[1].at;
        timers.delete(next[0]);
        next[1].callback();
        await flush();
      }
      now = end;
      await flush();
    }
  };
}

{
  const f = fixture();
  let calls = 0;
  const poller = f.poller(() => { calls++; });
  await poller.start();
  await poller.start();
  assert.equal(calls, 1, "Repeated start must not add refreshes or timers");
  assert.equal(f.timers.size, 1);
  await f.advance(999);
  assert.equal(calls, 1);
  await f.advance(1);
  assert.equal(calls, 2);
  poller.stop();
  await f.advance(5000);
  assert.equal(calls, 2);
  assert.equal(f.pageDocument.listenerCount() + f.pageWindow.listenerCount(), 0);
}

{
  const f = fixture({ hidden: true });
  let calls = 0;
  const poller = f.poller(() => { calls++; });
  await poller.start();
  await f.advance(5000);
  assert.equal(calls, 0, "Initially hidden pages must not fetch");
  assert.equal(f.timers.size, 0);
  f.pageDocument.hidden = false;
  f.pageDocument.dispatch("visibilitychange");
  await flush();
  assert.equal(calls, 1, "Returning to the page refreshes immediately");
  f.pageDocument.hidden = true;
  f.pageDocument.dispatch("visibilitychange");
  await f.advance(5000);
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
  f.pageDocument.hidden = false;
  f.pageDocument.dispatch("visibilitychange");
  await flush();
  assert.equal(calls, 2);
  f.pageWindow.navigator.onLine = false;
  f.pageWindow.dispatch("offline");
  await f.advance(5000);
  assert.equal(calls, 2, "Offline pages must not fetch");
  f.pageWindow.navigator.onLine = true;
  f.pageWindow.dispatch("online");
  await flush();
  assert.equal(calls, 3, "Reconnecting refreshes immediately");
  poller.stop();
}

{
  const f = fixture({ online: false });
  let calls = 0;
  const poller = f.poller(() => { calls++; });
  await poller.start();
  await poller.refresh();
  assert.equal(calls, 0, "Initially offline pages must not fetch");
  assert.equal(f.timers.size, 0);
  poller.stop();
}

{
  const f = fixture();
  let enabled = false;
  let calls = 0;
  const poller = f.poller(() => { calls++; }, { shouldRun: () => enabled });
  await poller.start();
  await f.advance(5000);
  assert.equal(calls, 0, "Inactive panels must not fetch");
  enabled = true;
  await poller.refresh();
  assert.equal(calls, 1);
  enabled = false;
  await f.advance(5000);
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0);
  enabled = true;
  await poller.refresh();
  assert.equal(calls, 2, "Opening the active panel can refresh immediately");
  poller.stop();
}

{
  const f = fixture();
  let release;
  const pending = new Promise((resolve) => { release = resolve; });
  let calls = 0;
  const poller = f.poller(() => { calls++; return calls === 1 ? pending : undefined; });
  const first = poller.start();
  await flush();
  assert.equal(poller.refresh(), first, "Concurrent refreshes share the running request");
  await f.advance(10000);
  assert.equal(calls, 1, "A slow response must never overlap another automatic request");
  assert.equal(f.timers.size, 0);
  release();
  await first;
  await f.advance(999);
  assert.equal(calls, 1, "The interval starts after completion, not after dispatch");
  await f.advance(1);
  assert.equal(calls, 2);
  poller.stop();
}

{
  const f = fixture();
  let calls = 0;
  const errors = [];
  const poller = f.poller(() => { calls++; throw new Error("request failed"); }, {
    async onError(error) { errors.push(error.message); throw new Error("report failed"); }
  });
  await poller.start();
  assert.deepEqual(errors, ["request failed"]);
  await f.advance(999);
  assert.equal(calls, 1, "Errors must not immediately retry in a loop");
  await f.advance(1);
  assert.equal(calls, 2, "A failed request or error handler must not stop later polling");
  poller.stop();
}

{
  const f = fixture();
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const poller = f.poller(() => { calls++; return calls === 1 ? pending : undefined; });
  const first = poller.start();
  await flush();
  f.pageDocument.hidden = true;
  f.pageDocument.dispatch("visibilitychange");
  release();
  await first;
  assert.equal(f.timers.size, 0, "A response finishing while hidden must not restart polling");
  await f.advance(5000);
  assert.equal(calls, 1);
  f.pageDocument.hidden = false;
  f.pageDocument.dispatch("visibilitychange");
  await flush();
  assert.equal(calls, 2);
  poller.stop();
}

{
  const f = fixture();
  let reject;
  let calls = 0;
  const pending = new Promise((_, rejectPromise) => { reject = rejectPromise; });
  const poller = f.poller(() => { calls++; return pending; });
  const first = poller.start();
  await flush();
  poller.stop();
  reject(new Error("late network failure"));
  await first;
  await f.advance(5000);
  assert.equal(calls, 1);
  assert.equal(f.timers.size, 0, "Stopping during an in-flight request prevents later scheduling");
  await poller.refresh();
  assert.equal(calls, 1);
}

{
  const f = fixture();
  let release;
  let calls = 0;
  const pending = new Promise((resolve) => { release = resolve; });
  const poller = f.poller(() => { calls++; return calls === 1 ? pending : undefined; });
  const first = poller.start();
  await flush();
  poller.stop();
  assert.equal(poller.start(), first, "Stop/start during a running request must not overlap it");
  release();
  await first;
  assert.equal(calls, 1);
  assert.equal(f.pageDocument.listenerCount(), 1);
  assert.equal(f.pageWindow.listenerCount(), 2);
  await f.advance(1000);
  assert.equal(calls, 2, "Restarted polling continues after the existing request settles");
  poller.stop();
}

{
  const f = fixture();
  let calls = 0;
  const poller = f.poller(() => { calls++; });
  const first = poller.start();
  poller.stop();
  await first;
  assert.equal(calls, 0, "Stopping before dispatch must prevent the queued request");
  assert.equal(f.timers.size, 0);
  assert.throws(() => f.poller(() => {}, { interval: 0 }), /positive/);
}

console.log("Polling: visibility/online/panel gating, immediate resume, sequential requests, error recovery, and stop/restart races passed.");
