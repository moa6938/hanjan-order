import { workerReady } from "./pwa.js";

export function setupPush({ supabase, pin, backendUrl, apiKey }) {
  const enable = document.querySelector("#push-enable");
  const test = document.querySelector("#push-test");
  const status = document.querySelector("#push-status");
  if (enable.dataset.ready) return;
  enable.dataset.ready = "true";
  let enabled = false;
  let busy = false;
  let statusTimer;

  function updateControls() {
    enable.disabled = busy;
    test.disabled = busy || !enabled;
  }
  function message(text, transient = false) {
    clearTimeout(statusTimer);
    status.textContent = text;
    status.hidden = !text;
    if (transient) statusTimer = setTimeout(() => message(""), 4000);
  }

  function setEnabled(value) {
    enabled = value;
    enable.textContent = value ? "화면 알림 켜짐" : "화면 알림 꺼짐";
    enable.setAttribute("aria-pressed", String(value));
    updateControls();
  }
  async function rpc(name, params) {
    const { data, error } = await supabase.rpc(name, { pin, ...params });
    if (error) throw new Error(error.code === "42501" ? "관리자 비밀번호를 다시 확인해 주세요." : "기기 등록 실패. 다시 시도해 주세요.");
    return data;
  }
  async function registration() {
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      throw new Error("알림 미지원 브라우저입니다. Chrome을 사용해 주세요.");
    }
    let timer;
    try {
      const worker = await Promise.race([workerReady, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("앱 준비 지연. 새로고침해 주세요.")), 12000);
      })]);
      if (!worker) throw new Error("앱 준비 실패. 새로고침해 주세요.");
      return worker;
    } finally { clearTimeout(timer); }
  }
  async function server(body) {
    const response = await fetch(`${backendUrl}/functions/v1/hanjan-push`, {
      method: body ? "POST" : "GET",
      headers: { apikey: apiKey, "Content-Type": "application/json" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15000)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(response.status === 401 ? "관리자 비밀번호를 다시 확인해 주세요." : "푸시 전송에 실패했어요. 잠시 후 알림 테스트를 다시 눌러주세요.");
    return result;
  }
  async function run(action) {
    busy = true;
    updateControls();
    message("");
    try { await action(); }
    catch (error) { message(error.name === "NotAllowedError" ? "브라우저 알림을 허용해 주세요." : error.message || "알림 설정 실패. 다시 시도해 주세요."); }
    finally { busy = false; updateControls(); }
  }

  enable.addEventListener("click", () => {
    if (enabled) {
      run(async () => {
        const subscription = await (await registration()).pushManager.getSubscription();
        if (subscription) {
          await rpc("hanjan_push_unregister", { subscription_endpoint: subscription.endpoint });
          setEnabled(false);
          await subscription.unsubscribe();
        }
        setEnabled(false);
      });
      return;
    }
    // Request permission in the user gesture, before fetching any server data.
    const permission = "Notification" in window ? Notification.requestPermission() : Promise.resolve("unsupported");
    run(async () => {
      if (await permission !== "granted") throw new Error("Chrome에서 알림을 허용해 주세요.");
      const worker = await registration();
      const { publicKey } = await server();
      const key = Uint8Array.from(atob(publicKey.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - publicKey.length % 4) % 4)), (char) => char.charCodeAt(0));
      let subscription = await worker.pushManager.getSubscription();
      if (subscription && Array.from(new Uint8Array(subscription.options.applicationServerKey || [])).join() !== Array.from(key).join()) {
        await rpc("hanjan_push_unregister", { subscription_endpoint: subscription.endpoint });
        await subscription.unsubscribe();
        subscription = null;
      }
      const created = !subscription;
      subscription ||= await worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key });
      try { await rpc("hanjan_push_register", { push_subscription: subscription.toJSON() }); }
      catch (error) { if (created) await subscription.unsubscribe().catch(() => {}); throw error; }
      setEnabled(true);
    });
  });
  test.addEventListener("click", () => run(async () => {
    const subscription = await (await registration()).pushManager.getSubscription();
    if (!subscription) { setEnabled(false); throw new Error("기기 연결 해제. 알림을 다시 켜주세요."); }
    const result = await server({ action: "test", pin, endpoint: subscription.endpoint });
    if (result.delivered !== 1) throw new Error("테스트 알림 전송 실패.");
    message("테스트 알림 전송 완료", true);
  }));
  run(async () => {
    const subscription = await (await registration()).pushManager.getSubscription();
    const saved = subscription && Notification.permission === "granted" && await rpc("hanjan_push_status", { subscription_endpoint: subscription.endpoint });
    setEnabled(Boolean(saved));
  });
}
