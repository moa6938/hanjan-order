import { createClient } from "@supabase/supabase-js";
import QRCode from "qrcode";
import { reorderedMenuIds } from "./menu-order.js";
import { activeOrderKey, clearActiveOrder, orderLookupCode, readActiveOrder, saveActiveOrder } from "./order-storage.js";
import { ordersToCsv, summarizeOrders } from "./stats.js";

const SUPABASE_URL = "https://oltgqudykkdsbifcuruy.supabase.co";
const SUPABASE_KEY = "sb_publishable_Z0wEhJVmJyuS2dS8jXLvaQ_kat48hsY";
const supabase = createClient(SUPABASE_URL, SUPABASE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false }
});

const statusLabels = { new: "접수 대기", making: "제조 중", done: "완료", canceled: "취소됨" };
const menuCategories = ["ADE", "NON SODA"];
const deviceIdKey = "drinkOrderDeviceId";
const orderView = document.querySelector("#order-view");
const adminView = document.querySelector("#admin-view");
const isAdmin = location.hash === "#admin" || location.pathname === "/admin";
const cookiePath = location.pathname.endsWith("/") ? location.pathname : location.pathname.replace(/[^/]*$/, "") || "/";

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
  let id;
  try {
    id = localStorage.getItem(deviceIdKey);
  } catch {
    id = null;
  }
  const cookieId = document.cookie.match(new RegExp(`(?:^|; )${deviceIdKey}=([^;]*)`))?.[1];
  id ||= cookieId && decodeURIComponent(cookieId);
  if (!id) {
    id = crypto.randomUUID();
  }
  try {
    localStorage.setItem(deviceIdKey, id);
  } catch {
    // The cookie below keeps the device ID when local storage is unavailable.
  }
  document.cookie = `${deviceIdKey}=${encodeURIComponent(id)}; Max-Age=31536000; Path=${cookiePath}; SameSite=Lax`;
  return id;
}

function todayInSeoul() {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Seoul" }).format(new Date());
}

function isTodayOrder(order) {
  return order.order_day === todayInSeoul();
}

function rememberActiveOrder(order) {
  saveActiveOrder(localStorage, order);
  saveActiveOrder(sessionStorage, order);
  document.cookie = `${activeOrderKey}=${encodeURIComponent(order.id)}; Max-Age=2592000; Path=${cookiePath}; SameSite=Lax`;
}

function forgetActiveOrder() {
  clearActiveOrder(localStorage);
  clearActiveOrder(sessionStorage);
  document.cookie = `${activeOrderKey}=; Max-Age=0; Path=${cookiePath}; SameSite=Lax`;
}

function rememberedOrderId() {
  for (const storage of [localStorage, sessionStorage]) {
    try {
      const id = storage.getItem(activeOrderKey);
      if (id) return id;
    } catch {
      // Try the next available persistence method.
    }
  }
  const cookieId = document.cookie.match(new RegExp(`(?:^|; )${activeOrderKey}=([^;]*)`))?.[1];
  return cookieId ? decodeURIComponent(cookieId) : null;
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

async function createOrder(items, customerName, partySize) {
  const { data, error } = await supabase
    .rpc("create_order", {
      order_items: items,
      order_note: "",
      order_customer_name: String(customerName || "").trim().slice(0, 20),
      order_party_size: Number(partySize),
      order_device_id: getDeviceId()
    })
    .single();
  if (error) throw error;
  return data;
}

async function setupOrderView() {
  const intake = document.querySelector("#order-intake");
  const lookupForm = document.querySelector("#order-lookup");
  const lookupInput = document.querySelector("#order-lookup-code");
  const lookupError = document.querySelector("#order-lookup-error");
  const form = document.querySelector("#order-form");
  const nameInput = document.querySelector("#customer-name");
  const menuList = document.querySelector("#menu-list");
  const categoryTabs = [...document.querySelectorAll("[data-menu-category]")];
  const template = document.querySelector("#menu-template");
  const error = document.querySelector("#order-error");
  const quantityError = document.querySelector("#quantity-error");
  const partySizeInput = document.querySelector("#party-size");
  const quantities = new Map();
  let menu = [];
  let pollingTimer;
  let currentOrder;
  let restoredActiveOrder = false;
  let submitting = false;
  let activeCategory = menuCategories[0];

  categoryTabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      activeCategory = tab.dataset.menuCategory;
      categoryTabs.forEach((item) => item.setAttribute("aria-pressed", String(item === tab)));
      renderMenu();
    });
  });

  function updateSubmitState() {
    const total = [...quantities.values()].reduce((sum, quantity) => sum + quantity, 0);
    const partySize = Number(partySizeInput.value) || 0;
    const tooMany = total > partySize;
    const locked = currentOrder && isTodayOrder(currentOrder) && currentOrder.status !== "canceled";
    const submit = form.querySelector("button[type=submit]");
    submit.disabled = submitting || locked || tooMany;
    submit.textContent = locked ? "오늘 주문 완료" : tooMany ? "인원수 확인 필요" : submitting ? "주문 처리 중…" : "주문 보내기";
    quantityError.textContent = tooMany ? "인당 음료는 하나만 주문할 수 있습니다." : "";
    renderSelectionSummary(total);
  }

  function renderSelectionSummary(total) {
    const list = document.querySelector("#selection-list");
    const selected = [...quantities].filter(([, quantity]) => quantity > 0);
    document.querySelector("#selection-total").textContent = `총 ${total}잔`;
    list.replaceChildren();
    if (!selected.length) {
      const empty = document.createElement("li");
      empty.className = "is-empty";
      empty.textContent = "아직 담은 음료가 없어요.";
      list.append(empty);
      return;
    }
    selected.forEach(([id, quantity]) => {
      const item = document.createElement("li");
      const name = document.createElement("span");
      const count = document.createElement("strong");
      name.textContent = menu.find((menuItem) => menuItem.id === id)?.name || "메뉴";
      count.textContent = `${quantity}잔`;
      item.append(name, count);
      list.append(item);
    });
  }

  function updateOrderAccess(order, restoreCustomerInfo = false) {
    currentOrder = order;
    const locked = isTodayOrder(order) && order.status !== "canceled";
    if (restoreCustomerInfo) {
      nameInput.value = order.customer_name;
      partySizeInput.value = order.party_size;
    }
    document.querySelector("#new-order-button").textContent = locked ? "메뉴 다시 보기" : "새 주문하기";
    updateSubmitState();
  }

  function openMenu() {
    document.querySelector("#order-summary-text").textContent = `${nameInput.value.trim()} · ${partySizeInput.value}명`;
    intake.hidden = true;
    form.hidden = false;
    form.scrollIntoView({ behavior: "smooth" });
  }

  intake.addEventListener("submit", (event) => {
    event.preventDefault();
    openMenu();
  });

  document.querySelector("#edit-order-info").addEventListener("click", () => {
    form.hidden = true;
    intake.hidden = false;
    intake.scrollIntoView({ behavior: "smooth" });
  });

  function startOrderPolling(orderId) {
    clearInterval(pollingTimer);
    const refresh = async () => {
      const { data: order, error: requestError } = await supabase.rpc("get_order", { order_id: orderId }).maybeSingle();
      setConnectionStatus(!requestError);
      if (order) {
        rememberActiveOrder(order);
        showTicket(order);
        updateOrderAccess(order, !restoredActiveOrder);
        if (!restoredActiveOrder) {
          form.hidden = true;
          intake.hidden = isTodayOrder(order) && order.status !== "canceled";
          lookupForm.hidden = true;
          restoredActiveOrder = true;
        }
      } else if (!requestError) {
        forgetActiveOrder();
      }
    };
    refresh();
    pollingTimer = setInterval(refresh, 2500);
  }

  function renderMenu() {
    const currentIds = new Set(menu.map((item) => item.id));
    [...quantities.keys()].filter((id) => !currentIds.has(id)).forEach((id) => quantities.delete(id));
    menuList.replaceChildren();
    categoryTabs.forEach((tab) => {
      const count = menu.filter((item) => item.category === tab.dataset.menuCategory).length;
      tab.textContent = `${tab.dataset.menuCategory} ${count}`;
      tab.disabled = count === 0;
    });
    const grid = document.createElement("div");
    grid.className = "menu-grid";
    menu.filter((item) => item.category === activeCategory).forEach((item) => {
        if (!quantities.has(item.id)) quantities.set(item.id, 0);
        if (!item.is_available) quantities.set(item.id, 0);
        const card = template.content.firstElementChild.cloneNode(true);
        card.dataset.id = item.id;
        card.classList.toggle("is-sold-out", !item.is_available);
        card.querySelector("h2").textContent = item.name;
        card.querySelector(".menu-icon").textContent = item.icon;
        card.querySelector(".sold-out-label").hidden = item.is_available;
        card.classList.toggle("is-selected", quantities.get(item.id) > 0);
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
          card.classList.toggle("is-selected", next > 0);
          updateSubmitState();
        });
        grid.append(card);
    });
    menuList.append(grid);
    updateSubmitState();
  }

  async function refreshMenu() {
    const { data, error: requestError } = await supabase.rpc("list_menu_items");
    if (requestError) throw requestError;
    menu = data;
    renderMenu();
    setConnectionStatus(true);
  }

  const cachedOrder = readActiveOrder(localStorage) || readActiveOrder(sessionStorage);
  const activeOrderId = rememberedOrderId() || cachedOrder?.id;
  if (activeOrderId) {
    if (cachedOrder?.id === activeOrderId) {
      rememberActiveOrder(cachedOrder);
      showTicket(cachedOrder);
      updateOrderAccess(cachedOrder, true);
      form.hidden = true;
      intake.hidden = isTodayOrder(cachedOrder) && cachedOrder.status !== "canceled";
      lookupForm.hidden = true;
      restoredActiveOrder = true;
    }
    startOrderPolling(activeOrderId);
  }

  try {
    await refreshMenu();
    setInterval(() => refreshMenu().catch(() => setConnectionStatus(false)), 5000);
  } catch (requestError) {
    error.textContent = readableError(requestError);
    setConnectionStatus(false);
  }

  partySizeInput.addEventListener("input", updateSubmitState);

  lookupForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    lookupError.textContent = "";
    const { data: order, error: requestError } = await supabase
      .rpc("get_order_by_code", { order_code: lookupInput.value.trim() })
      .maybeSingle();
    if (requestError) {
      lookupError.textContent = readableError(requestError);
      return;
    }
    if (!order?.id) {
      lookupError.textContent = "주문 확인코드를 다시 확인해 주세요.";
      return;
    }
    rememberActiveOrder(order);
    restoredActiveOrder = true;
    showTicket(order);
    updateOrderAccess(order, true);
    form.hidden = true;
    intake.hidden = isTodayOrder(order) && order.status !== "canceled";
    lookupForm.hidden = true;
    startOrderPolling(order.id);
  });

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
        document.querySelector("#customer-name").value,
        document.querySelector("#party-size").value
      );
      rememberActiveOrder(order);
      restoredActiveOrder = true;
      showTicket(order);
      updateOrderAccess(order);
      startOrderPolling(order.id);
      form.hidden = true;
      lookupForm.hidden = true;
    } catch (requestError) {
      error.textContent = readableError(requestError);
    } finally {
      submitting = false;
      updateSubmitState();
    }
  });

  document.querySelector("#new-order-button").addEventListener("click", () => {
    const locked = currentOrder && isTodayOrder(currentOrder) && currentOrder.status !== "canceled";
    document.querySelector("#edit-order-info").hidden = locked;
    if (locked) openMenu();
    else {
      form.hidden = true;
      intake.hidden = false;
      intake.scrollIntoView({ behavior: "smooth" });
    }
  });

  document.querySelector("#copy-order-code").addEventListener("click", async (event) => {
    try {
      await navigator.clipboard.writeText(orderLookupCode(currentOrder));
      event.currentTarget.textContent = "복사됨";
    } catch {
      event.currentTarget.textContent = "코드를 길게 눌러 복사";
    }
  });

}

function showTicket(order) {
  const ticket = document.querySelector("#ticket");
  const badge = document.querySelector("#ticket-status");
  document.querySelector("#ticket-id").textContent = displayId(order);
  document.querySelector("#ticket-customer").textContent = formatCustomer(order);
  document.querySelector("#ticket-code").textContent = orderLookupCode(order);
  document.querySelector("#copy-order-code").textContent = "코드 복사";
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
  const tabs = [...document.querySelectorAll("[data-admin-tab]")];
  const panels = [...document.querySelectorAll(".admin-panel")];
  const popularList = document.querySelector("#popular-menu-list");
  const statsMonth = document.querySelector("#stats-month");
  const csvButton = document.querySelector("#download-orders-csv");
  const orders = new Map();
  const knownOrderIds = new Set();
  let monthlyOrders = [];
  let audioContext;
  let audioEnabled = false;
  let adminPin = "";
  let hasLoaded = false;

  statsMonth.value = todayInSeoul().slice(0, 7);
  statsMonth.max = statsMonth.value;

  tabs.forEach((tab) => {
    tab.addEventListener("click", () => {
      tabs.forEach((item) => item.setAttribute("aria-selected", String(item === tab)));
      panels.forEach((panel) => { panel.hidden = panel.id !== `${tab.dataset.adminTab}-panel`; });
      if (tab.dataset.adminTab === "stats" && adminPin) refreshMonthlyStats().catch(() => setConnectionStatus(false));
    });
  });

  function renderStats() {
    const summary = summarizeOrders(monthlyOrders);
    document.querySelector("#stat-orders").textContent = `${summary.orders}건`;
    document.querySelector("#stat-drinks").textContent = `${summary.drinks}잔`;
    document.querySelector("#stat-active").textContent = `${summary.active}건`;
    document.querySelector("#stat-done").textContent = `${summary.done}건`;
    document.querySelector("#stat-canceled").textContent = `${summary.canceled}건`;
    csvButton.disabled = monthlyOrders.length === 0;
    popularList.replaceChildren();
    if (!summary.popular.length) {
      const empty = document.createElement("li");
      empty.textContent = "아직 집계할 주문이 없어요.";
      popularList.append(empty);
      return;
    }
    summary.popular.forEach(([name, quantity]) => {
      const item = document.createElement("li");
      const label = document.createElement("span");
      const count = document.createElement("strong");
      label.textContent = name;
      count.textContent = `${quantity}잔`;
      item.append(label, count);
      popularList.append(item);
    });
  }

  csvButton.addEventListener("click", () => {
    const blob = new Blob(["\ufeff", ordersToCsv(monthlyOrders)], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `주문내역-${statsMonth.value}.csv`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url));
  });

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

      const categoryItems = items.filter((item) => item.category === category);
      categoryItems.forEach((item, index) => {
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

        const orderActions = document.createElement("div");
        orderActions.className = "admin-menu-order";
        [["up", "↑ 위로"], ["down", "↓ 아래로"]].forEach(([direction, label]) => {
          const move = document.createElement("button");
          move.type = "button";
          move.textContent = label;
          move.setAttribute("aria-label", `${item.name} ${direction === "up" ? "위로 이동" : "아래로 이동"}`);
          move.disabled = direction === "up" ? index === 0 : index === categoryItems.length - 1;
          move.addEventListener("click", async () => {
            const orderedIds = reorderedMenuIds(items, item.id, direction);
            if (!orderedIds) return;
            menuError.textContent = "";
            orderActions.querySelectorAll("button").forEach((button) => (button.disabled = true));
            const { error } = await supabase.rpc("admin_reorder_menu", {
              pin: adminPin,
              ordered_menu_ids: orderedIds
            });
            if (error) menuError.textContent = readableError(error);
            else await refreshAdminMenu();
          });
          orderActions.append(move);
        });

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
        row.append(name, orderActions, actions);
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
        customer.textContent = formatCustomer(order);
        items.textContent = formatItems(order.items);
        detail.append(customer, items);

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
              refreshMonthlyStats().catch(() => setConnectionStatus(false));
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

  async function refreshMonthlyStats() {
    const { data, error } = await supabase.rpc("admin_list_orders_by_month", {
      pin: adminPin,
      selected_month: `${statsMonth.value}-01`
    });
    if (error) throw error;
    monthlyOrders = data;
    renderStats();
  }

  statsMonth.addEventListener("change", () => refreshMonthlyStats().catch(() => setConnectionStatus(false)));

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

    await Promise.all([refreshOrders(), refreshAdminMenu(), refreshMonthlyStats()]);
    setInterval(() => refreshOrders().catch(() => setConnectionStatus(false)), 2500);
    setInterval(() => refreshAdminMenu().catch(() => setConnectionStatus(false)), 5000);
    setInterval(() => refreshMonthlyStats().catch(() => setConnectionStatus(false)), 30000);
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
