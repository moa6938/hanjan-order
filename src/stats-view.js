const numberFormat = new Intl.NumberFormat("ko-KR", { maximumFractionDigits: 1 });
const number = (value) => numberFormat.format(value);
const shortDate = (date) => `${Number(date.slice(5, 7))}/${Number(date.slice(8, 10))}`;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

function renderChart(list, rows, { value, label, description }) {
  const max = Math.max(1, ...rows.map(value));
  list.replaceChildren(...rows.map((row) => {
    const count = value(row);
    const item = element("li", "chart-column");
    const detail = description(row);
    item.tabIndex = 0;
    item.title = detail;
    item.setAttribute("aria-label", detail);
    const track = element("span", "chart-track");
    track.setAttribute("aria-hidden", "true");
    track.style.setProperty("--bar-height", `${count / max * 100}%`);
    const bar = element("span", `chart-bar${count === max && count > 0 ? " is-peak" : ""}`);
    bar.style.height = `${count / max * 100}%`;
    const amount = element("span", "chart-value", count ? number(count) : "");
    const tooltip = element("span", "chart-tooltip", detail);
    tooltip.setAttribute("aria-hidden", "true");
    track.append(bar, amount);
    item.append(track, element("span", "chart-label", label(row)), tooltip);
    return item;
  }));
}

function addRow(body, cells) {
  const row = document.createElement("tr");
  cells.forEach((value, index) => {
    const cell = element(index === 0 ? "th" : "td", "", value);
    if (index === 0) cell.scope = "row";
    row.append(cell);
  });
  body.append(row);
  return row;
}

export function createStatsView(root) {
  const get = (id) => root.querySelector(`#${id}`);
  const text = (id, value) => { get(id).textContent = value; };
  let currentReport;
  let weekdayMetric = "total";

  function renderWeekdays() {
    if (!currentReport) return;
    const average = weekdayMetric === "average";
    text("stats-weekday-basis", average ? "해당 요일의 음료 합계 ÷ 그 요일의 날짜 수 (주문 없는 날 포함)" : "선택한 달의 요일별 음료 합계");
    renderChart(get("stats-weekday-chart"), currentReport.weekdays, {
      value: (row) => average ? row.averageDrinks : row.drinks,
      label: (row) => row.label,
      description: (row) => `${row.label}요일 · ${row.days}일 · 주문 ${number(row.orders)}건 · 음료 ${number(row.drinks)}잔 · 하루 평균 ${number(row.averageDrinks)}잔`
    });
  }

  root.querySelectorAll("[data-weekday-metric]").forEach((button) => {
    button.addEventListener("click", () => {
      weekdayMetric = button.dataset.weekdayMetric;
      root.querySelectorAll("[data-weekday-metric]").forEach((item) => item.setAttribute("aria-pressed", String(item === button)));
      renderWeekdays();
    });
  });

  return {
    render(report) {
      currentReport = report;
      const summary = report.summary;
      text("stat-orders", `${number(summary.orders)}건`);
      text("stat-valid-orders", `취소 제외 ${number(summary.validOrders)}건`);
      text("stat-drinks", `${number(summary.drinks)}잔`);
      text("stat-people", `${number(summary.people)}명`);
      text("stat-average", `${number(summary.averageDrinksPerActiveDay)}잔`);
      text("stat-ordering-days", `주문이 있는 ${number(summary.orderingDays)}일 기준`);
      text("stat-active", `${number(summary.active)}건`);
      text("stat-done", `${number(summary.done)}건`);
      text("stat-rate", `취소 제외 완료율 ${number(summary.completionRate)}%`);
      text("stat-canceled", `${number(summary.canceled)}건`);
      text("stat-cancel-rate", `전체 주문 중 ${number(summary.orders ? summary.canceled / summary.orders * 100 : 0)}%`);
      get("stats-empty").hidden = summary.orders > 0;
      const range = report.daily;
      text("stats-period", range.length ? `${shortDate(range[0].date)} ~ ${shortDate(range.at(-1).date)} 집계` : "조회할 달을 선택해 주세요.");
      const peak = (rows) => rows.reduce((best, row) => row.drinks > (best?.drinks || 0) ? row : best, null);
      const weekday = peak(report.weekdays);
      const hour = peak(report.hours);
      const day = peak(report.daily);
      text("stats-peak-weekday", weekday ? `${weekday.label}요일 · ${number(weekday.drinks)}잔` : "—");
      text("stats-peak-hour", hour ? `${hour.hour}~${hour.hour + 1}시 · ${number(hour.drinks)}잔` : "—");
      text("stats-daily-peak", day ? `최다 ${shortDate(day.date)} · ${number(day.drinks)}잔` : "주문 음료 없음");

      renderChart(get("stats-daily-chart"), report.daily, {
        value: (row) => row.drinks,
        label: (row) => String(Number(row.date.slice(8, 10))),
        description: (row) => `${shortDate(row.date)} · 주문 ${number(row.orders)}건 · 음료 ${number(row.drinks)}잔 · 이용인원 ${number(row.people)}명 · 취소 ${number(row.canceled)}건`
      });
      const dailyBody = get("stats-daily-body");
      dailyBody.replaceChildren();
      report.daily.forEach((row) => addRow(dailyBody, [shortDate(row.date), `${number(row.orders)}건`, `${number(row.drinks)}잔`, `${number(row.people)}명`, `${number(row.canceled)}건`]));
      renderWeekdays();
      const weeklyBody = get("stats-weekly-body");
      weeklyBody.replaceChildren();
      report.weeks.forEach((row) => addRow(weeklyBody, [`${shortDate(row.start)}~${shortDate(row.end)}`, `${number(row.orders)}건`, `${number(row.drinks)}잔`, `${number(row.people)}명`, `${number(row.canceled)}건`]));
      renderChart(get("stats-hour-chart"), report.hours, {
        value: (row) => row.drinks,
        label: (row) => String(row.hour),
        description: (row) => `${row.hour}~${row.hour + 1}시 · 주문 ${number(row.orders)}건 · 음료 ${number(row.drinks)}잔 · 이용인원 ${number(row.people)}명`
      });
      const menuBody = get("stats-menu-body");
      menuBody.replaceChildren();
      text("stats-menu-count", `${number(report.menus.length)}개 메뉴`);
      report.menus.forEach((row, index) => {
        const tr = addRow(menuBody, [`${index + 1}. ${row.name}`, `${number(row.orders)}건`, `${number(row.drinks)}잔`, `${number(row.share)}%`]);
        const share = element("span", "menu-share-track");
        share.setAttribute("aria-hidden", "true");
        const fill = element("span", "menu-share-fill");
        fill.style.width = `${row.share}%`;
        share.append(fill);
        tr.lastElementChild.append(share);
      });
      if (!report.menus.length) {
        const row = addRow(menuBody, ["집계할 메뉴가 없어요."]);
        row.firstElementChild.colSpan = 4;
      }
    }
  };
}
