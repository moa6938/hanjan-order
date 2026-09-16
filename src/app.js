import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";

const SUPABASE_URL = "https://oltgqudykkdsbifcuruy.supabase.co";
const SUPABASE_KEY = "sb_publishable_Z0wEhJVmJyuS2dS8jXLvaQ_kat48hsY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const statusLabels = { new: "접수 대기", making: "제조 중", done: "완료", canceled: "취소됨" };
const menuCategories = ["ADE", "NON SODA"];
const activeOrderKey = "activeOrderId";
const deviceIdKey = "drinkOrderDeviceId";
const orderView = document.querySelector("#order-view");
const adminView = document.querySelector("#admin-view");
const isAdmin = location.hash === "#admin" || location.pathname === "/admin";

(isAdmin ? adminView : orderView).hidden = false;
document.title = isAdmin ? "주문 관리 · 한 잔 주문" : "음료 주문 · 한 잔 주문";

function displayId(order) {
  return `A${String(order.order_number).padStart(3, "0")}`;
}

function formatItems(items) {
  return items.map((item) => `• ${item.name} — ${item.quantity}잔`).join("\n");
}

function formatCustomer(order) {
  return `${order.customer_name} · ${order.party_size}명`;
}

function formatTime(iso) {
  return new Intl.DateTimeFormat("ko-KR", { hour: "2-digit", minute: "2-digit" }).format(new Date(iso));
}

function getDeviceId() {
  let id = localStorage.getItem(deviceIdKey);
  if (!id) {
    id = crypto.randomUUID();
    localStorage.setItem(deviceIdKey, id);
  }
  return id;
}

function todayInSeoul() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function isTodayOrder(order) {
  return order.order_day === todayInSeoul();
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
  if (error?.message?.includes("menu item unavailable")) {
    return "선택한 메뉴가 품절되었거나 변경됐습니다. 다시 선택해 주세요.";
  }
  if (error?.message?.includes("invalid customer") || error?.message?.includes("invalid party")) {
    return "주문자 이름과 인원수를 확인해 주세요.";
  }
  if (error?.message?.includes("orders_one_active_per_device_day")) {
    return "이 기기에서는 오늘 이미 주문했습니다. 기존 주문이 취소되면 다시 주문할 수 있어요.";
  }
  if (error?.code === "23505") {
    return "같은 이름의 메뉴가 이미 있습니다.";
  }
  return "연결이 원활하지 않습니다. 잠시 후 다시 시도해 주세요.";
}

if (isAdmin) setupAdminView();
else setupOrderView();

async function createOrder(items, note, customerName, partySize) {
  const { data, error } = await supabase
    .rpc("create_order", {
      order_items: items,
      order_note: String(note || "").trim().slice(0, 80),
      order_customer_name: String(customerName || "").trim().slice(0, 20),
      order_party_size: Number(partySize),
      order_device_id: getDeviceId()
    })
    .single();
  if (error) throw error;
  return data;
}

async function setupOrderView() {
  const form = document.querySelector("#order-form");
  const menuList = document.querySelector("#menu-list");
  const template = document.querySelector("#menu-template");
  const error = document.querySelector("#order-error");
  const quantityError = document.querySelector("#quantity-error");
  const partySizeInput = document.querySelector("#party-size");
  const quantities = new Map();
  let menu = [];
  let pollingTimer;
  let currentOrder;
  let submitting = false;

  function updateSubmitState() {
    const total = [...quantities.values()].reduce((sum, quantity) => sum + quantity, 0);
    const partySize = Number(partySizeInput.value) || 0;
    const tooMany = total > partySize;
    const locked = currentOrder && isTodayOrder(currentOrder) && currentOrder.status !== "canceled";
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = submitting || locked || tooMany;
    submit.textContent = locked ? "오늘 주문 완료" : tooMany ? "인원수 확인 필요" : submitting ? "주문 처리 중…" : "주문 보내기";
    quantityError.textContent = tooMany ? "인당 음료는 하나만 주문할 수 있습니다." : "";
  }

  function updateOrderAccess(order) {
    currentOrder = order;
    const locked = isTodayOrder(order) && order.status !== "canceled";
    document.querySelector("#new-order-button").textContent = locked ? "메뉴 다시 보기" : "새 주문하기";
    updateSubmitState();
  }

  function startOrderPolling(orderId) {
    clearInterval(pollingTimer);
    const refresh = async () => {
      const { data: order, error: requestError } = await supabase.rpc("get_order", { order_id: orderId }).maybeSingle();
      setConnectionStatus(!requestError);
      if (order) {
        showTicket(order);
        updateOrderAccess(order);
      }
    };
    refresh();
    pollingTimer = setInterval(refresh, 2500);
  }

  function renderMenu() {
    const currentIds = new Set(menu.map((item) => item.id));
    [...quantities.keys()].filter((id) => !currentIds.has(id)).forEach((id) => quantities.delete(id));
    menuList.replaceChildren();

    menuCategories.forEach((category) => {
      const categoryItems = menu.filter((item) => item.category === category);
      if (!categoryItems.length) return;
      const section = document.createElement("section");
      const title = document.createElement("h2");
      const grid = document.createElement("div");
      title.className = "menu-section-title";
      title.textContent = category;
      grid.className = "menu-grid";

      categoryItems.forEach((item) => {
        if (!quantities.has(item.id)) quantities.set(item.id, 0);
        if (!item.is_available) quantities.set(item.id, 0);
        const card = template.content.firstElementChild.cloneNode(true);
        card.dataset.id = item.id;
        card.classList.toggle("is-sold-out", !item.is_available);
        card.querySelector("h2").textContent = item.name;
        card.querySelector(".menu-icon").textContent = item.icon;
        card.querySelector(".sold-out-label").hidden = item.is_available;
        const output = card.querySelector("output");
        output.value = quantities.get(item.id);
        output.textContent = quantities.get(item.id);
        card.querySelectorAll("button").forEach((button) => (button.disabled = !item.is_available));
        card.addEventListener("click", (event) => {
          const action = event.target.closest("button")?.dataset.action;
          if (!action || !item.is_available) return;
          const current = quantities.get(item.id);
          const next = action === "plus" ? Math.min(current + 1, 9) : Math.max(current - 1, 0);
          quantities.set(item.id, next);
          output.value = next;
          output.textContent = next;
          updateSubmitState();
        });
        grid.append(card);
      });
      section.append(title, grid);
      menuList.append(section);
    });
    updateSubmitState();
  }

  async function refreshMenu() {
    const { data, error: requestError } = await supabase.rpc("list_menu_items");
    if (requestError) throw requestError;
    menu = data;
    renderMenu();
    setConnectionStatus(true);
  }

  try {
    await refreshMenu();
    setInterval(() => refreshMenu().catch(() => setConnectionStatus(false)), 5000);
  } catch (requestError) {
    error.textContent = readableError(requestError);
    setConnectionStatus(false);
  }

  partySizeInput.addEventListener("input", updateSubmitState);

  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    error.textContent = "";
    if (currentOrder && isTodayOrder(currentOrder) && currentOrder.status !== "canceled") {
      error.textContent = "이 기기에서는 오늘 이미 주문했습니다. 내 주문 상태를 확인해 주세요.";
      document.querySelector("#ticket").scrollIntoView({ behavior: "smooth" });
      return;
    }
    const items = [...quantities]
      .filter(([, quantity]) => quantity > 0)
      .map(([id, quantity]) => ({ id, name: menu.find((item) => item.id === id).name, quantity }));
    if ([...quantities.values()].reduce((sum, quantity) => sum + quantity, 0) > Number(partySizeInput.value)) return;
    if (!items.length) {
      error.textContent = "음료를 한 개 이상 선택해 주세요.";
      return;
    }

    submitting = true;
    updateSubmitState();
    try {
      const order = await createOrder(
        items,
        document.querySelector("#order-note").value,
        document.querySelector("#customer-name").value,
        document.querySelector("#party-size").value
      );
      localStorage.setItem(activeOrderKey, order.id);
      showTicket(order);
      updateOrderAccess(order);
      startOrderPolling(order.id);
      form.hidden = true;
    } catch (requestError) {
      error.textContent = readableError(requestError);
    } finally {
      submitting = false;
      updateSubmitState();
    }
  });

  document.querySelector("#new-order-button").addEventListener("click", () => {
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth" });
  });

  const activeOrderId = localStorage.getItem(activeOrderKey) || sessionStorage.getItem(activeOrderKey);
  if (activeOrderId) {
    localStorage.setItem(activeOrderKey, activeOrderId);
    sessionStorage.removeItem(activeOrderKey);
    const { data: order } = await supabase.rpc("get_order", { order_id: activeOrderId }).maybeSingle();
    if (order) {
      showTicket(order);
      updateOrderAccess(order);
      startOrderPolling(order.id);
      form.hidden = isTodayOrder(order) && order.status !== "canceled";
    } else {
      localStorage.removeItem(activeOrderKey);
    }
  }

}

function showTicket(order) {
  const ticket = document.querySelector("#ticket");
  const badge = document.querySelector("#ticket-status");
  document.querySelector("#ticket-id").textContent = displayId(order);
  document.querySelector("#ticket-customer").textContent = formatCustomer(order);
  document.querySelector("#ticket-items").textContent = formatItems(order.items);
  badge.textContent = statusLabels[order.status];
  badge.className = `status-badge status-${order.status}`;
  document.querySelector("#ticket-message").textContent = {
    new: "1층에서 주문을 확인하고 있어요. 오늘은 이 주문만 가능해요.",
    making: "음료를 만들고 있어요. 오늘은 이 주문만 가능해요.",
    done: "음료가 완성됐어요. 1층에서 받아주세요! 오늘은 이 주문만 가능해요.",
    canceled: "주문이 취소됐어요. 새 주문을 할 수 있습니다."
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
  const menuForm = document.querySelector("#menu-add-form");
  const menuList = document.querySelector("#admin-menu-list");
  const menuError = document.querySelector("#menu-error");
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

  function renderAdminMenu(items) {
    menuList.replaceChildren();
    menuCategories.forEach((category) => {
      const group = document.createElement("section");
      const heading = document.createElement("h3");
      heading.textContent = category;
      group.className = "admin-menu-group";
      group.append(heading);

      items.filter((item) => item.category === category).forEach((item) => {
        const row = document.createElement("div");
        row.className = "admin-menu-item";

        const name = document.createElement("div");
        name.className = "admin-menu-name";
        const icon = document.createElement("span");
        const input = document.createElement("input");
        const status = document.createElement("small");
        icon.textContent = item.icon;
        input.value = item.name;
        input.maxLength = 30;
        input.setAttribute("aria-label", `${item.name} 이름`);
        status.textContent = item.is_available ? "판매 중" : "품절";
        name.append(icon, input, status);

        const actions = document.createElement("div");
        actions.className = "admin-menu-actions";
        const rename = document.createElement("button");
        rename.type = "button";
        rename.textContent = "이름 저장";
        rename.addEventListener("click", async () => {
          const nextName = input.value.trim();
          if (!nextName || nextName === item.name) return;
          rename.disabled = true;
          const { error } = await supabase.rpc("admin_rename_menu", {
            pin: adminPin,
            menu_id: item.id,
            item_name: nextName
          });
          if (error) menuError.textContent = readableError(error);
          else await refreshAdminMenu();
          rename.disabled = false;
        });
        const availability = document.createElement("button");
        availability.type = "button";
        availability.textContent = item.is_available ? "품절 처리" : "판매 재개";
        availability.addEventListener("click", async () => {
          availability.disabled = true;
          const { error } = await supabase.rpc("admin_set_menu_available", {
            pin: adminPin,
            menu_id: item.id,
            available: !item.is_available
          });
          if (error) menuError.textContent = readableError(error);
          else await refreshAdminMenu();
          availability.disabled = false;
        });

        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "danger";
        remove.textContent = "삭제";
        remove.addEventListener("click", async () => {
          if (!confirm(`${item.name} 메뉴를 삭제할까요?`)) return;
          remove.disabled = true;
          const { error } = await supabase.rpc("admin_remove_menu", { pin: adminPin, menu_id: item.id });
          if (error) menuError.textContent = readableError(error);
          else await refreshAdminMenu();
          remove.disabled = false;
        });

        actions.append(rename, availability, remove);
        row.append(name, actions);
        group.append(row);
      });
      menuList.append(group);
    });
  }

  async function refreshAdminMenu() {
    const { data, error } = await supabase.rpc("list_menu_items");
    if (error) throw error;
    renderAdminMenu(data);
  }

  menuForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    menuError.textContent = "";
    const submit = menuForm.querySelector("button[type=submit]");
    submit.disabled = true;
    const { error } = await supabase.rpc("admin_add_menu", {
      pin: adminPin,
      item_name: document.querySelector("#menu-name").value,
      item_icon: document.querySelector("#menu-icon").value,
      item_category: document.querySelector("#menu-category").value
    });
    if (error) {
      menuError.textContent = readableError(error);
    } else {
      document.querySelector("#menu-name").value = "";
      await refreshAdminMenu();
    }
    submit.disabled = false;
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
        const customer = document.createElement("strong");
        const items = document.createElement("p");
        const note = document.createElement("small");
        customer.textContent = formatCustomer(order);
        items.textContent = formatItems(order.items);
        note.textContent = order.note ? `요청: ${order.note}` : statusLabels[order.status];
        detail.append(customer, items, note);

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

    await Promise.all([refreshOrders(), refreshAdminMenu()]);
    setInterval(() => refreshOrders().catch(() => setConnectionStatus(false)), 2500);
    setInterval(() => refreshAdminMenu().catch(() => setConnectionStatus(false)), 5000);
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
