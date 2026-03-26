const BASE_TICKERS = [
  "SBER",
  "GAZP",
  "LKOH",
  "GMKN",
  "ROSN",
  "NVTK",
  "TATN",
  "YNDX",
  "MOEX",
  "SNGS",
];

const tickerSelect = document.getElementById("ticker");
const form = document.getElementById("analyzerForm");
const resultBox = document.getElementById("result");
const strongOnlyCheckbox = document.getElementById("strongOnly");
const exportBtn = document.getElementById("exportBtn");
const clearHistoryBtn = document.getElementById("clearHistoryBtn");
const historyList = document.getElementById("historyList");

const HISTORY_KEY = "mmvb_signal_history_v1";
const LAST_RUN_KEY = "mmvb_signal_last_run_v1";

let lastRun = null; // { ts, input, results: [{ticker, analysis}] }

for (const ticker of BASE_TICKERS) {
  const option = document.createElement("option");
  option.value = ticker;
  option.textContent = ticker;
  tickerSelect.appendChild(option);
}

function classifySignal(data) {
  const antiFiltersTriggered =
    !data.level ||
    !data.volume ||
    data.phase === "impulse_middle" ||
    data.phase === "flat" ||
    data.trend === "flat" ||
    data.trend === "unclear" ||
    data.indicators === "conflict" ||
    data.structure === "unclear" ||
    data.rr < 2;

  if (antiFiltersTriggered) {
    return {
      result: "НЕТ СИГНАЛА",
      quality: "слабый",
      probability: "—",
      short: "Сейчас нет понятного сигнала.",
      explanation: "Сработал фильтр риска: лучше пропустить вход, чем открыть слабую сделку.",
      entry: "—",
      stop: "—",
      target: "—",
    };
  }

  let score = 0;
  if (data.level) score += 1;
  if (data.volume) score += 1;
  if (data.structure === "clear") score += 1;
  if (data.candle) score += 1;
  if (data.trend === "up" || data.trend === "down") score += 1;
  if (data.indicators !== "neutral") score += 1;

  const quality = score >= 5 ? "сильный" : score >= 4 ? "умеренный" : "слабый";
  if (quality !== "сильный") {
    return {
      result: "НЕТ СИГНАЛА",
      quality,
      probability: "—",
      short: "Подтверждений недостаточно для уверенного входа.",
      explanation: "Часть условий выполнена, но этого мало для безопасного сценария.",
      entry: "—",
      stop: "—",
      target: "—",
    };
  }

  const result = data.trend === "up" ? "BUY" : "SELL";
  let probability = 75;
  if (data.volume) probability += 5;
  if (data.level) probability += 5;
  if (data.phase === "correction") probability -= 5;

  const price = Number(data.price) || 0;
  const move = price > 0 ? price * 0.02 : 0;
  const entry = price > 0 ? price.toFixed(2) : "рыночный вход";
  const stop = price > 0 ? (result === "BUY" ? price - move : price + move).toFixed(2) : "по структуре";
  const target = price > 0 ? (result === "BUY" ? price + move * 2 : price - move * 2).toFixed(2) : "по тренду";

  return {
    result,
    quality,
    probability: `${Math.min(probability, 90)}%`,
    short: result === "BUY" ? "Покупатели сильнее, цена идет вверх." : "Продавцы сильнее, цена идет вниз.",
    explanation: "Есть уровень, объем и подтверждение структуры. Сигнал проходит основной фильтр риска.",
    entry,
    stop,
    target,
  };
}

function renderCard(ticker, analysis) {
  const statusClass =
    analysis.result === "BUY"
      ? "status-buy"
      : analysis.result === "SELL"
      ? "status-sell"
      : "status-none";

  return `
    <div class="card">
      <h3>${ticker}</h3>
      <p><strong>Итог:</strong> <span class="${statusClass}">${analysis.result}</span></p>
      <p><strong>Качество сигнала:</strong> ${analysis.quality}</p>
      <p><strong>Вероятность:</strong> ${analysis.probability}</p>
      <p><strong>Кратко:</strong> ${analysis.short}</p>
      <ul>
        <li>Вход: ${analysis.entry}</li>
        <li>Стоп: ${analysis.stop}</li>
        <li>Цель: ${analysis.target}</li>
      </ul>
      <p><strong>Объяснение:</strong> ${analysis.explanation}</p>
    </div>
  `;
}

function renderCards(cards) {
  const strongOnly = !!strongOnlyCheckbox.checked;
  const visible = strongOnly
    ? cards.filter((c) => c.analysis.quality === "сильный")
    : cards;

  if (!visible.length) {
    resultBox.innerHTML = `<p class="muted">Нет сильных сигналов по текущему расчету.</p>`;
    return;
  }

  resultBox.innerHTML = visible.map((c) => renderCard(c.ticker, c.analysis)).join("");
}

function summarizeRun(run) {
  const ts = run?.ts;
  const input = run?.input || {};
  const results = Array.isArray(run?.results) ? run.results : [];
  const strongCount = results.filter((c) => c.analysis?.quality === "сильный").length;

  const modeKey = input.mode || "—";
  const modeLabel =
    modeKey === "one"
      ? "1-клик анализ"
      : modeKey === "top3"
      ? "ТОП-3"
      : modeKey === "daily"
      ? "Ежедневный отчет"
      : modeKey;
  const ticker = input.ticker || "—";
  const resultsCount = results.length ? `${results.length} акц.` : "—";
  return {
    ts,
    mode: modeLabel,
    ticker,
    resultsCount,
    strongCount,
  };
}

function renderHistory() {
  if (!historyList) return;

  const history = loadHistory();
  if (!history.length) {
    historyList.innerHTML = `<p class="muted">Пока нет сохраненных расчетов.</p>`;
    return;
  }

  historyList.innerHTML = history
    .slice(0, 10)
    .map((run) => {
      const s = summarizeRun(run);
      const title = s.mode === "1-клик анализ" ? s.ticker : `${s.mode}`;
      const dt = s.ts ? fmtDate(s.ts) : "—";
      const strongText = s.strongCount ? `Сильных: ${s.strongCount}` : "Сильных: 0";

      return `
        <div class="history-item">
          <div class="history-meta">
            <div><strong>${title}</strong></div>
            <div class="small">${dt}</div>
            <div class="small">${s.resultsCount} • ${strongText}</div>
          </div>
          <button class="btn-secondary history-show" type="button" data-show-ts="${s.ts || ""}">
            Показать
          </button>
        </div>
      `;
    })
    .join("");

  historyList.querySelectorAll(".history-show").forEach((btn) => {
    btn.addEventListener("click", () => {
      const ts = Number(btn.getAttribute("data-show-ts"));
      const run = loadHistory().find((r) => Number(r?.ts) === ts);
      if (!run) return;
      lastRun = run;
      saveLastRun(run);
      renderCards(lastRun.results || []);
    });
  });
}

function getTicker() {
  const customTicker = document.getElementById("customTicker").value.trim().toUpperCase();
  if (!customTicker) return tickerSelect.value;
  return customTicker;
}

function getFormData() {
  return {
    mode: document.getElementById("mode").value,
    ticker: getTicker(),
    price: document.getElementById("price").value,
    trend: document.getElementById("trend").value,
    phase: document.getElementById("phase").value,
    structure: document.getElementById("structure").value,
    indicators: document.getElementById("indicators").value,
    rr: Number(document.getElementById("rr").value),
    level: document.getElementById("level").checked,
    volume: document.getElementById("volume").checked,
    candle: document.getElementById("candle").checked,
  };
}

function buildModeCards(baseData) {
  if (baseData.mode === "one") {
    return [{ ticker: baseData.ticker, analysis: classifySignal(baseData) }];
  }

  if (baseData.mode === "top3") {
    const mock = [
      { ...baseData, ticker: "SBER", trend: "up" },
      { ...baseData, ticker: "LKOH", trend: "up" },
      { ...baseData, ticker: "YNDX", trend: "down" },
    ];
    return mock.map((item) => ({ ticker: item.ticker, analysis: classifySignal(item) }));
  }

  const mockDaily = [
    { ...baseData, ticker: "GAZP", trend: "up" },
    { ...baseData, ticker: "ROSN", trend: "down" },
    { ...baseData, ticker: "MOEX", trend: "flat", phase: "flat" },
  ];

  return mockDaily.map((item) => ({ ticker: item.ticker, analysis: classifySignal(item) }));
}

function safeParseJSON(raw, fallback) {
  try {
    return JSON.parse(raw) ?? fallback;
  } catch {
    return fallback;
  }
}

function loadHistory() {
  return safeParseJSON(localStorage.getItem(HISTORY_KEY), []);
}

function saveHistory(history) {
  localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
}

function saveLastRun(run) {
  localStorage.setItem(LAST_RUN_KEY, JSON.stringify(run));
}

function loadLastRun() {
  return safeParseJSON(localStorage.getItem(LAST_RUN_KEY), null);
}

function fmtDate(ts) {
  const d = new Date(ts);
  const pad = (n) => String(n).padStart(2, "0");
  return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function buildExportHtml(run) {
  const { ts, input, results } = run;

  const strongOnly = !!strongOnlyCheckbox.checked;
  const visible = strongOnly
    ? results.filter((c) => c.analysis.quality === "сильный")
    : results;

  const cardsHtml = visible.length
    ? visible.map((c) => renderCard(c.ticker, c.analysis)).join("")
    : `<p class="muted">Нет сильных сигналов по текущему расчету.</p>`;

  const inputLines = Object.entries(input)
    .map(([k, v]) => `<tr><td class="k">${k}</td><td class="v">${String(v)}</td></tr>`)
    .join("");

  // Самодостаточный файл: встраиваем минимальный CSS, чтобы карточки выглядели корректно.
  return `<!doctype html>
<html lang="ru">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>MMVB Signal | Отчет</title>
    <style>
      * { box-sizing: border-box; }
      body { margin:0; font-family: Arial, sans-serif; background:#0f1422; color:#e8edff; line-height:1.4; }
      .container { width:min(1000px,92%); margin:0 auto; padding:24px 0; }
      .hero { padding:18px 0 10px; }
      h1 { margin:0 0 8px; font-size:26px; }
      .muted { color:#9cadde; }
      .panel { margin-top:16px; padding:16px; background:#171f34; border-radius:14px; }
      .card { background:#11182a; border:1px solid #2e3d64; border-radius:12px; padding:14px; }
      .cards { display:grid; gap:12px; }
      table { width:100%; border-collapse: collapse; margin-top:10px; }
      td { padding:8px 10px; border-bottom:1px solid #2e3d64; }
      td.k { width: 38%; color:#bfc9ec; }
      .status-buy { color:#78f0a3; }
      .status-sell { color:#ff8a8a; }
      .status-none { color:#ffd66d; }
    </style>
  </head>
  <body>
    <div class="container">
      <div class="hero">
        <h1>MMVB Signal — Отчет</h1>
        <p class="muted">Дата: ${fmtDate(ts)}</p>
        <p class="muted">Фильтр: ${strongOnly ? "только сильные" : "все сигналы"}</p>
      </div>

      <div class="panel">
        <h2 style="margin:0 0 8px; font-size:18px;">Параметры</h2>
        <table>
          ${inputLines}
        </table>
      </div>

      <div class="panel">
        <h2 style="margin:0 0 8px; font-size:18px;">Результат</h2>
        <div class="cards">
          ${cardsHtml}
        </div>
      </div>
    </div>
  </body>
</html>`;
}

function downloadHtml(filename, html) {
  const blob = new Blob([html], { type: "text/html;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}

function initFromLastRun() {
  const loaded = loadLastRun();
  if (!loaded || !Array.isArray(loaded.results)) return;

  lastRun = loaded;
  renderCards(lastRun.results);
}

strongOnlyCheckbox.addEventListener("change", () => {
  if (!lastRun || !Array.isArray(lastRun.results)) return;
  renderCards(lastRun.results);
});

exportBtn.addEventListener("click", () => {
  const run = lastRun || loadLastRun();
  if (!run || !Array.isArray(run.results)) {
    alert("Сначала выполните анализ, чтобы экспортировать отчет.");
    return;
  }

  const now = new Date();
  const pad = (n) => String(n).padStart(2, "0");
  const name = `mmvb_report_${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}_${pad(now.getHours())}-${pad(now.getMinutes())}.html`;

  const html = buildExportHtml(run);
  downloadHtml(name, html);
});

clearHistoryBtn.addEventListener("click", () => {
  localStorage.removeItem(HISTORY_KEY);
  localStorage.removeItem(LAST_RUN_KEY);
  lastRun = null;
  strongOnlyCheckbox.checked = false;
  resultBox.innerHTML = `<p class="muted">История очищена.</p>`;
  if (historyList) historyList.innerHTML = `<p class="muted">История очищена.</p>`;
});

form.addEventListener("submit", (event) => {
  event.preventDefault();
  const data = getFormData();

  if (!data.ticker || data.ticker.trim() === "") {
    resultBox.innerHTML = `<p class="muted">Укажите тикер (можно из списка или вручную).</p>`;
    return;
  }

  const results = buildModeCards(data);
  lastRun = {
    ts: Date.now(),
    input: data,
    results,
  };

  saveLastRun(lastRun);

  const history = loadHistory();
  history.unshift(lastRun);
  // Ограничим размер истории, чтобы localStorage не разрастался.
  saveHistory(history.slice(0, 30));

  renderCards(results);
  renderHistory();
});

initFromLastRun();
renderHistory();
