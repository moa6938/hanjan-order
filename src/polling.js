export function createPoller(run, {
  interval,
  shouldRun = () => true,
  onError = () => {},
  pageDocument = globalThis.document,
  pageWindow = globalThis.window
}) {
  if (!Number.isFinite(interval) || interval <= 0) throw new RangeError("Polling interval must be positive");
  let started = false;
  let timer;
  let inFlight;

  function eligible() {
    return started && !pageDocument?.hidden && pageWindow?.navigator?.onLine !== false && shouldRun();
  }

  function clearTimer() {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  }

  function schedule() {
    clearTimer();
    if (eligible()) timer = setTimeout(refresh, interval);
  }

  function refresh() {
    clearTimer();
    if (!eligible()) return Promise.resolve();
    if (inFlight) return inFlight;
    inFlight = Promise.resolve()
      .then(() => { if (eligible()) return run(); })
      .catch(async (error) => {
        try { await onError(error); } catch { /* Error reporting must not stop future refreshes. */ }
      })
      .finally(() => {
        inFlight = undefined;
        schedule();
      });
    return inFlight;
  }

  function start() {
    if (started) return inFlight || Promise.resolve();
    started = true;
    pageDocument?.addEventListener("visibilitychange", refresh);
    pageWindow?.addEventListener("online", refresh);
    pageWindow?.addEventListener("offline", refresh);
    return refresh();
  }

  function stop() {
    started = false;
    clearTimer();
    pageDocument?.removeEventListener("visibilitychange", refresh);
    pageWindow?.removeEventListener("online", refresh);
    pageWindow?.removeEventListener("offline", refresh);
  }

  return { start, refresh, stop };
}
