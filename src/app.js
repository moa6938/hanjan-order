import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

const SUPABASE_URL = "https://oltgqudykkdsbifcuruy.supabase.co";
const SUPABASE_KEY = "sb_publishable_Z0wEhJVmJyuS2dS8jXLvaQ_kat48hsY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const MENU = [
  { id: "iced-tea", name: "아이스티", icon: "🧊" },
  { id: "lemonade", name: "레모네이드", icon: "🍋" },
  { id: "ade", name: "오늘의 에이드", icon: "🥤" }
];
const statusLabels = { new: "접수 대기", making: "제조 중", done: "완료", canceled: "취소됨" };
const orderView = document.querySelector("#order-view");
const adminView = document.querySelector("#admin-view");
const isAdmin = location.hash === "#admin" || location.pathname === "/admin";

(isAdmin ? adminView : orderView).hidden = false;
document.title = isAdmin ? "주문 관리 · 한 잔 주문" : "음료 주문 · 한 잔 주문";

function displayId(order) {
  return `A${String(order.order_number).padStart(3, "0")}`;
}

function formatItems(items) {
  return items.map((item) => `${item.name} ${item.quantity}잔`).join(" · ");
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function setConnectionStatus(connected) {
  const element = document.querySelector("#connection-status");
  element.lastChild.textContent = connected ? " 연결됨" : " 연결 중";
  element.classList.toggle("is-offline", !connected);
}

function readableError(error) {
  console.error(error);
  if (error?.code === "42P01" || error?.message?.includes("schema cache")) {
    return "주문 저장소가 아직 준비되지 않았습니다.";
  }
  return "연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.";
}

if (isAdmin) setupAdminView();
else setupOrderView();

async function createOrder(items, note) {
  const { data, error } = await supabase
    .rpc("create_order", { order_items: items, order_note: String(note || "").trim().slice(0, 80) })
    .single();
  if (error) throw error;
  return data;
}

async function setupOrderView() {
  const form = document.querySelector("#order-form");
  const menuList = document.querySelector("#menu-list");
  const template = document.querySelector("#menu-template");
  const error = document.querySelector("#order-error");
  const quantities = new Map();
  let pollingTimer;

  function startOrderPolling(orderId) {
    clearInterval(pollingTimer);
    const refresh = async () => {
      const { data: order, error: requestError } = await supabase.rpc("get_order", { order_id: orderId }).maybeSingle();
      setConnectionStatus(!requestError);
      if (order) showTicket(order);
    };
    refresh();
    pollingTimer = setInterval(refresh, 2500);
  }

  MENU.forEach((item) => {
    quantities.set(item.id, 0);
    const card = template.content.firstElementChild.cloneNode(true);
    card.dataset.id = item.id;
    card.querySelector("h2").textContent = item.name;
    card.querySelector(".menu-icon").textContent = item.icon;
    const output = card.querySelector("output");
    card.addEventListener("click", (event) => {
      const action = event.target.closest("button")?.dataset.action;
      if (!action) return;
      const current = quantities.get(item.id);
      const next = action === "plus" ? Math.min(current + 1, 9) : Math.max(current - 1, 0);
      quantities.set(item.id, next);
      output.value = next;
      output.textContent = next;
    });
    menuList.append(card);
  });

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    const items = [...quantities]
      .filter(([, quantity]) => quantity > 0)
      .map(([id, quantity]) => ({ id, name: MENU.find((item) => item.id === id).name, quantity }));
    if (!items.length) {
      error.textContent = "음료를 한 개 이상 선택해 주세요.";
      return;
    }

    const submit = form.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const order = await createOrder(items, document.querySelector("#order-note").value);
      sessionStorage.setItem("activeOrderId", order.id);
      showTicket(order);
      startOrderPolling(order.id);
      form.hidden = true;
    } catch (requestError) {
      error.textContent = readableError(requestError);
    } finally {
      submit.disabled = false;
    }
  });

  document.querySelector("#new-order-button").addEventListener("click", () => {
    sessionStorage.removeItem("activeOrderId");
    location.reload();
  });

  const activeOrderId = sessionStorage.getItem("activeOrderId");
  if (activeOrderId) {
    const { data: order } = await supabase.rpc("get_order", { order_id: activeOrderId }).maybeSingle();
    if (order) {
      showTicket(order);
      startOrderPolling(order.id);
      form.hidden = true;
    } else {
      sessionStorage.removeItem("activeOrderId");
    }
  }

}

function showTicket(order) {
  const ticket = document.querySelector("#ticket");
  const badge = document.querySelector("#ticket-status");
  document.querySelector("#ticket-id").textContent = displayId(order);
  document.querySelector("#ticket-items").textContent = formatItems(order.items);
  badge.textContent = statusLabels[order.status];
  badge.className = `status-badge status-${order.status}`;
  document.querySelector("#ticket-message").textContent = {
    new: "1층에서 주문을 확인하고 있어요.",
    making: "음료를 만들고 있어요. 잠시만 기다려주세요.",
    done: "음료가 완성됐어요. 1층에서 받아주세요!",
    canceled: "주문이 취소됐어요. 1층에 문의해주세요."
  }[order.status];
  ticket.hidden = false;
}

async function setupAdminView() {
  const login = document.querySelector("#admin-login");
  const pinInput = document.querySelector("#admin-pin");
  const loginError = document.querySelector("#admin-login-error");
  const dashboard = document.querySelector("#admin-dashboard");
  const list = document.querySelector("#order-list");
  const audioButton = document.querySelector("#audio-button");
  const orders = new Map();
  const knownOrderIds = new Set();
  let audioContext;
  let audioEnabled = false;
  let adminPin = "";
  let hasLoaded = false;

  function chime() {
    if (!audioEnabled || !audioContext) return;
    const now = audioContext.currentTime;
    [660, 880].forEach((frequency, index) => {
      const oscillator = audioContext.createOscillator();
      const gain = audioContext.createGain();
      oscillator.frequency.value = frequency;
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      const start = now + index * 0.18;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.28, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.24);
      oscillator.start(start);
      oscillator.stop(start + 0.25);
    });
  }

  audioButton.addEventListener("click", async () => {
    audioContext ||= new AudioContext();
    await audioContext.resume();
    audioEnabled = true;
    audioButton.textContent = "🔔 알림 켜짐";
    audioButton.classList.add("is-on");
    chime();
  });

  function render() {
    list.replaceChildren();
    if (!orders.size) {
      const empty = document.createElement("div");
      const title = document.createElement("strong");
      empty.className = "empty-state";
      title.textContent = "아직 들어온 주문이 없어요.";
      empty.append(title, "새 주문이 오면 이곳에 바로 표시됩니다.");
      list.append(empty);
      return;
    }

    [...orders.values()]
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .forEach((order) => {
        const card = document.createElement("article");
        card.className = `order-card is-${order.status}`;

        const number = document.createElement("div");
        number.className = "order-number";
        const strong = document.createElement("strong");
        const time = document.createElement("time");
        strong.textContent = displayId(order);
        time.textContent = formatTime(order.created_at);
        number.append(strong, time);

        const detail = document.createElement("div");
        detail.className = "order-detail";
        const items = document.createElement("p");
        const note = document.createElement("small");
        items.textContent = formatItems(order.items);
        note.textContent = order.note ? `요청: ${order.note}` : statusLabels[order.status];
        detail.append(items, note);

        const actions = document.createElement("div");
        actions.className = "order-actions";
        if (order.status === "new") actions.append(statusButton("제조 시작", "making", true));
        if (order.status === "making") actions.append(statusButton("완료", "done", true));
        if (!["done", "canceled"].includes(order.status)) actions.append(statusButton("취소", "canceled"));

        function statusButton(label, status, emphasized = false) {
          const button = document.createElement("button");
          button.type = "button";
          button.textContent = label;
          if (emphasized) button.className = "complete";
          button.addEventListener("click", async () => {
            button.disabled = true;
            const { data, error } = await supabase
              .rpc("admin_update_order", { pin: adminPin, order_id: order.id, next_status: status })
              .single();
            if (error) {
              alert(readableError(error));
              button.disabled = false;
            } else {
              orders.set(data.id, data);
              render();
            }
          });
          return button;
        }

        card.append(number, detail, actions);
        list.append(card);
      });
  }

  async function refreshOrders() {
    const { data, error } = await supabase.rpc("admin_list_orders", { pin: adminPin });
    if (error) throw error;
    const newOrderArrived = hasLoaded && data.some((order) => !knownOrderIds.has(order.id));
    orders.clear();
    data.forEach((order) => {
      orders.set(order.id, order);
      knownOrderIds.add(order.id);
    });
    render();
    setConnectionStatus(true);
    if (newOrderArrived) chime();
    hasLoaded = true;
  }

  async function startDashboard() {
    const orderUrl = `${location.origin}${location.pathname}#order`;
    document.querySelector("#order-url").textContent = orderUrl;
    const qrUrl = await QRCode.toDataURL(orderUrl, { width: 360, margin: 2, errorCorrectionLevel: "M" });
    document.querySelector("#qr-image").src = qrUrl;
    document.querySelector("#download-qr-link").href = qrUrl;
    document.querySelector("#copy-url-button").addEventListener("click", async (event) => {
      await navigator.clipboard.writeText(orderUrl);
      event.currentTarget.textContent = "복사됨";
    });

    await refreshOrders();
    setInterval(() => refreshOrders().catch(() => setConnectionStatus(false)), 2500);
  }

  login.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";
    const candidate = pinInput.value;
    const submit = login.querySelector("button[type=submit]");
    submit.disabled = true;
    try {
      const { data: accepted, error } = await supabase.rpc("admin_check_pin", { pin: candidate });
      if (error) throw error;
      if (!accepted) {
        loginError.textContent = "비밀번호가 올바르지 않습니다.";
        pinInput.select();
        return;
      }
      adminPin = candidate;
      pinInput.value = "";
      login.hidden = true;
      dashboard.hidden = false;
      await startDashboard();
    } catch (error) {
      loginError.textContent = readableError(error);
    } finally {
      submit.disabled = false;
    }
  });
}
