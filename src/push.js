import { workerReady } from "./pwa.js";

export function setupPush({ supabase, pin, backendUrl, apiKey }) {
  const enable = document.querySelector("#push-enable");
  const test = document.querySelector("#push-test");
  const disable = document.querySelector("#push-disable");
  const status = document.querySelector("#push-status");
  if (enable.dataset.ready) return;
  enable.dataset.ready = "true";
  const controls = [enable, test, disable];

  function setEnabled(value) {
    enable.hidden = value;
    test.hidden = !value;
    disable.hidden = !value;
  }
  async function rpc(name, params) {
    const { data, error } = await supabase.rpc(name, { pin, ...params });
    if (error) throw new Error(error.code === "42501" ? "관리자 비밀번호를 다시 확인해 주세요." : "알림 기기 정보를 저장하지 못했어요. 연결을 확인하고 다시 시도해 주세요.");
    return data;
  }
  async function registration() {
    if (!window.isSecureContext || !("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) {
      throw new Error("이 브라우저는 푸시 알림을 지원하지 않아요. 안드로이드 Chrome에서 열어주세요.");
    }
    let timer;
    try {
      const worker = await Promise.race([workerReady, new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("앱 준비가 지연되고 있어요. 새로고침 후 다시 시도해 주세요.")), 12000);
      })]);
      if (!worker) throw new Error("앱을 준비하지 못했어요. 새로고침해 주세요.");
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
    controls.forEach((button) => { button.disabled = true; });
    status.textContent = "알림 연결을 확인하고 있어요…";
    try { await action(); }
    catch (error) { status.textContent = error.name === "NotAllowedError" ? "브라우저 또는 기기 설정에서 이 사이트의 알림을 허용해 주세요." : error.message || "알림 설정에 실패했어요. 다시 시도해 주세요."; }
    finally { controls.forEach((button) => { button.disabled = false; }); }
  }

  enable.addEventListener("click", () => {
    // Request permission in the user gesture, before fetching any server data.
    const permission = "Notification" in window ? Notification.requestPermission() : Promise.resolve("unsupported");
    run(async () => {
      if (await permission !== "granted") throw new Error("Chrome 사이트 설정에서 알림을 허용한 뒤 다시 눌러주세요.");
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
      status.textContent = "푸시 알림을 켰어요. ‘알림 테스트’로 수신을 확인하세요.";
    });
  });
  test.addEventListener("click", () => run(async () => {
    const subscription = await (await registration()).pushManager.getSubscription();
    if (!subscription) { setEnabled(false); throw new Error("기기 연결이 해제됐어요. 알림을 다시 켜주세요."); }
    const result = await server({ action: "test", pin, endpoint: subscription.endpoint });
    if (result.delivered !== 1) throw new Error("알림이 전송되지 않았어요. 기기 설정을 확인해 주세요.");
    status.textContent = "이 기기로 테스트 알림을 전송했어요. 알림창에 도착했는지 확인하세요.";
  }));
  disable.addEventListener("click", () => run(async () => {
    const subscription = await (await registration()).pushManager.getSubscription();
    if (subscription) {
      await rpc("hanjan_push_unregister", { subscription_endpoint: subscription.endpoint });
      await subscription.unsubscribe();
    }
    setEnabled(false);
    status.textContent = "이 기기의 푸시 알림을 껐어요. 다른 기기는 유지됩니다.";
  }));
  run(async () => {
    const subscription = await (await registration()).pushManager.getSubscription();
    const saved = subscription && Notification.permission === "granted" && await rpc("hanjan_push_status", { subscription_endpoint: subscription.endpoint });
    setEnabled(Boolean(saved));
    status.textContent = saved ? "이 기기의 푸시 알림이 켜져 있어요. ‘알림 테스트’로 확인하세요." : "‘화면 꺼짐 알림 켜기’를 눌러 이 태블릿의 알림을 허용하세요.";
  });
}
