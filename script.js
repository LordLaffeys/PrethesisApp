// Frontend integration for FastAPI Stock Return Inference API
// Uses endpoints:
//   POST /recent   -> last 20 days (close + returns)
//   POST /infer    -> next 5-step predicted prices
//   POST /metrics  -> directional accuracy table (DA)
//
// NOTE: Static hosting (Vercel, GitHub Pages) cannot truly hide an API key.
// For demo purposes, you can still send a header and validate it server-side.

const API_BASE = "https://ceola-unmusical-yolande.ngrok-free.dev"; // <-- your ngrok URL
const API_KEY = ""; // optional demo key, sent as X-API-Key

function buildHeaders() {
  const h = { "Content-Type": "application/json" };
  if (API_KEY) h["X-API-Key"] = API_KEY;
  return h;
}

// Chart buffers (mutable)
const stockData = [];      // OHLC derived from closes for candlesticks
const predictionData = []; // {time, price} for +1..+5

class StockChart {
  constructor(canvasId) {
    this.canvas = document.getElementById(canvasId);
    this.ctx = this.canvas.getContext("2d");
    this.mode = "candlestick"; // "candlestick" | "line"
    this.setupCanvas();
    this.minPrice = 0;
    this.maxPrice = 1;
    this.padding = { top: 20, right: 50, bottom: 20, left: 20 };
  }

  setMode(mode) {
    this.mode = mode === "line" ? "line" : "candlestick";
  }

  setupCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;

    this.canvas.width = rect.width * dpr;
    this.canvas.height = rect.height * dpr;

    // reset transform to avoid cumulative scaling on resize
    this.ctx.setTransform(1, 0, 0, 1, 0, 0);
    this.ctx.scale(dpr, dpr);

    this.canvas.style.width = rect.width + "px";
    this.canvas.style.height = rect.height + "px";
    this.width = rect.width;
    this.height = rect.height;
  }

  setRangeFromData() {
    const all = [
      ...stockData.map((d) => d.low),
      ...stockData.map((d) => d.high),
      ...predictionData.map((p) => p.price),
    ];
    if (!all.length) {
      this.minPrice = 0;
      this.maxPrice = 1;
      return;
    }
    const minV = Math.min(...all);
    const maxV = Math.max(...all);
    const pad = (maxV - minV) * 0.08 || Math.max(1, maxV * 0.02);
    this.minPrice = minV - pad;
    this.maxPrice = maxV + pad;
  }

  priceToY(price) {
    const chartHeight = this.height - this.padding.top - this.padding.bottom;
    const priceRange = this.maxPrice - this.minPrice || 1;
    return (
      this.padding.top +
      chartHeight * (1 - (price - this.minPrice) / priceRange)
    );
  }

  timeToX(time, timeRange) {
    const chartWidth = this.width - this.padding.left - this.padding.right;
    const tr = timeRange || 1;
    return this.padding.left + (time / tr) * chartWidth;
  }

  drawGridLines(totalPoints) {
    this.ctx.strokeStyle = "rgba(0, 0, 0, 0.1)";
    this.ctx.lineWidth = 1;
    const timeRange = Math.max(1, totalPoints - 1);

    const steps = 8;
    for (let i = 0; i <= steps; i++) {
      const price = this.minPrice + (i / steps) * (this.maxPrice - this.minPrice);
      const y = this.priceToY(price);
      this.ctx.beginPath();
      this.ctx.moveTo(this.padding.left, y);
      this.ctx.lineTo(this.width - this.padding.right, y);
      this.ctx.stroke();
    }

    const timeStep = Math.max(1, Math.floor(totalPoints / 10));
    for (let i = 0; i < totalPoints; i += timeStep) {
      const x = this.timeToX(i, timeRange);
      this.ctx.beginPath();
      this.ctx.moveTo(x, this.padding.top);
      this.ctx.lineTo(x, this.height - this.padding.bottom);
      this.ctx.stroke();
    }
  }

  drawCandlestick(data, x) {
    const candleWidth = 8;
    const openY = this.priceToY(data.open);
    const closeY = this.priceToY(data.close);
    const highY = this.priceToY(data.high);
    const lowY = this.priceToY(data.low);

    const isBullish = data.close > data.open;
    const bodyColor = isBullish ? "#22c55e" : "#ef4444";
    const wickColor = isBullish ? "#16a34a" : "#dc2626";

    // wick
    this.ctx.strokeStyle = wickColor;
    this.ctx.lineWidth = 1;
    this.ctx.beginPath();
    this.ctx.moveTo(x, highY);
    this.ctx.lineTo(x, lowY);
    this.ctx.stroke();

    // body
    this.ctx.fillStyle = bodyColor;
    this.ctx.strokeStyle = wickColor;
    const bodyHeight = Math.max(1, Math.abs(closeY - openY));
    const bodyY = Math.min(openY, closeY);
    this.ctx.fillRect(x - candleWidth / 2, bodyY, candleWidth, bodyHeight);
    this.ctx.strokeRect(x - candleWidth / 2, bodyY, candleWidth, bodyHeight);
  }

  drawHistoricalLine(totalPoints) {
    if (stockData.length < 2) return;
    const timeRange = Math.max(1, totalPoints - 1);

    this.ctx.strokeStyle = "#111827";
    this.ctx.lineWidth = 2;
    this.ctx.beginPath();

    stockData.forEach((d, idx) => {
      const x = this.timeToX(idx, timeRange);
      const y = this.priceToY(d.close);
      if (idx === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    });

    this.ctx.stroke();
  }

  drawPredictionLine(totalPoints) {
    if (predictionData.length < 2) return;
    const timeRange = Math.max(1, totalPoints - 1);

    this.ctx.strokeStyle = "#3498db";
    this.ctx.lineWidth = 3;
    this.ctx.beginPath();

    predictionData.forEach((pt, i) => {
      const x = this.timeToX(pt.time, timeRange);
      const y = this.priceToY(pt.price);
      if (i === 0) this.ctx.moveTo(x, y);
      else this.ctx.lineTo(x, y);
    });
    this.ctx.stroke();

    this.ctx.fillStyle = "#3498db";
    predictionData.forEach((pt) => {
      const x = this.timeToX(pt.time, timeRange);
      const y = this.priceToY(pt.price);
      this.ctx.beginPath();
      this.ctx.arc(x, y, 3, 0, 2 * Math.PI);
      this.ctx.fill();
    });
  }

  render() {
    this.setRangeFromData();
    this.ctx.clearRect(0, 0, this.width, this.height);

    const horizon = 5;
    const totalPoints = stockData.length + horizon;

    this.drawGridLines(totalPoints);

    const timeRange = Math.max(1, totalPoints - 1);

    if (this.mode === "candlestick") {
      stockData.forEach((d, idx) => {
        const x = this.timeToX(idx, timeRange);
        this.drawCandlestick(d, x);
      });
    } else {
      this.drawHistoricalLine(totalPoints);
    }

    this.drawPredictionLine(totalPoints);
  }
}

// ------------------------
// UI helpers
// ------------------------
function showLoadingScreen() {
  const overlay = document.getElementById("loadingOverlay");
  requestAnimationFrame(() => overlay.classList.add("show"));

  ["step1", "step2", "step3"].forEach((id) => {
    const el = document.getElementById(id);
    el.classList.remove("active", "completed");
  });
  document.getElementById("step1").classList.add("active");
}

function updateLoadingStep(stepNumber, status) {
  const step = document.getElementById(`step${stepNumber}`);
  step.classList.remove("active", "completed");
  if (status === "active") step.classList.add("active");
  if (status === "completed") step.classList.add("completed");
}

function hideLoadingScreen() {
  document.getElementById("loadingOverlay").classList.remove("show");
}

function setModelHint(text) {
  document.getElementById("modelHint").textContent = text || "";
}

function enforceModelRules() {
  const scenario = document.getElementById("scenarioSelect").value;
  const modelSelect = document.getElementById("modelSelect");
  const sgaOpt = [...modelSelect.options].find((o) => o.value === "SGA_LSTM");

  if (scenario === "baseline") {
    if (sgaOpt) sgaOpt.disabled = true;
    if (modelSelect.value === "SGA_LSTM") modelSelect.value = "LSTM";
    setModelHint("Note: baseline method doesn't support SGA_LSTM.");
  } else {
    if (sgaOpt) sgaOpt.disabled = false;
    setModelHint("");
  }
}

function toOHLCFromCloses(closes) {
  const out = [];
  for (let i = 0; i < closes.length; i++) {
    const close = Number(closes[i]);
    const prev = i === 0 ? close : Number(closes[i - 1]);
    const open = prev;
    const high = Math.max(open, close);
    const low = Math.min(open, close);
    out.push({ time: i, open, high, low, close });
  }
  return out;
}

function addDaysISO(dateStr, days) {
  // dateStr expected YYYY-MM-DD
  const d = new Date(dateStr + "T00:00:00");
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

function updateHeader(ticker, recentDates, forecastDates) {
  document.getElementById("headerStock").textContent = ticker;
  if (Array.isArray(recentDates) && recentDates.length) {
    const start = recentDates[0];
    const end = (forecastDates && forecastDates.length) ? forecastDates[forecastDates.length - 1] : recentDates[recentDates.length - 1];
    document.getElementById("headerRange").textContent = `${start} - ${end} (last 20 days + 5-step forecast)`;
  } else {
    document.getElementById("headerRange").textContent = "Last 20 days + 5-step forecast";
  }
}

function updateModelDetails(scenario, model, da) {
  document.getElementById("methodLabel").textContent = scenario;
  document.getElementById("modelLabel").textContent = model;
  document.getElementById("daLabel").textContent =
    typeof da === "number" && !Number.isNaN(da) ? `${da.toFixed(2)}%` : "-";
}

function renderSeriesTable(recentDates, recentCloses, forecastDates, forecastPrices) {
  const host = document.getElementById("seriesTable");
  if (!host) return;

  const rows = [];

  // last 20
  for (let i = 0; i < recentDates.length; i++) {
    rows.push({
      date: recentDates[i],
      price: Number(recentCloses[i]),
      tag: "actual",
    });
  }

  // next 5
  for (let i = 0; i < forecastDates.length; i++) {
    rows.push({
      date: forecastDates[i],
      price: Number(forecastPrices[i]),
      tag: "forecast",
    });
  }

  host.innerHTML = `
    <table>
      <thead>
        <tr>
          <th>Date</th>
          <th>Close</th>
          <th>Type</th>
        </tr>
      </thead>
      <tbody>
        ${rows
          .map((r) => {
            const price = typeof r.price === "number" && !Number.isNaN(r.price) ? r.price.toFixed(2) : "-";
            return `
              <tr>
                <td>${r.date}</td>
                <td>${price}</td>
                <td><span class="tag">${r.tag}</span></td>
              </tr>
            `;
          })
          .join("")}
      </tbody>
    </table>
  `;
}

// ------------------------
// API helpers
// ------------------------
async function postJSON(url, body) {
  const resp = await fetch(url, {
    method: "POST",
    headers: buildHeaders(),
    body: JSON.stringify(body),
  });

  const ct = resp.headers.get("content-type") || "";
  const payload = ct.includes("application/json") ? await resp.json() : await resp.text();

  if (!resp.ok) {
    const msg =
      payload && payload.detail
        ? payload.detail
        : typeof payload === "string"
        ? payload
        : "Request failed";
    throw new Error(msg);
  }
  return payload;
}

async function fetchRecent(ticker, scenario) {
  return await postJSON(`${API_BASE}/recent`, {
    ticker,
    scenario,
    n_days: 20,
    return_type: "log",
  });
}

async function fetchInfer(ticker, scenario, model_type) {
  return await postJSON(`${API_BASE}/infer`, {
    ticker,
    scenario,
    model_type,
  });
}

async function fetchMetrics(ticker, scenario, model_type) {
  return await postJSON(`${API_BASE}/metrics`, {
    ticker,
    scenario,
    model_type,
  });
}

// ------------------------
// Main page logic
// ------------------------
document.addEventListener("DOMContentLoaded", function () {
  const chart = new StockChart("stockChart");
  chart.render();

  // Resize handler
  window.addEventListener("resize", function () {
    chart.setupCanvas();
    chart.render();
  });

  // Rules: baseline has no SGA_LSTM
  enforceModelRules();
  document.getElementById("scenarioSelect").addEventListener("change", () => {
    enforceModelRules();
  });

  document.getElementById("chartTypeSelect").addEventListener("change", () => {
    chart.setMode(document.getElementById("chartTypeSelect").value);
    chart.render();
  });

  document.getElementById("btnPredict").addEventListener("click", async function () {
    const button = this;
    const originalText = button.textContent;
    const startTime = Date.now();
    const minDisplayTime = 600;

    button.disabled = true;
    button.textContent = "Predicting...";
    showLoadingScreen();

    try {
      const ticker = document.getElementById("stockSymbol").value;
      const scenario = document.getElementById("scenarioSelect").value;
      const model_type = document.getElementById("modelSelect").value;
      const chartType = document.getElementById("chartTypeSelect").value;

      // 1) recent
      updateLoadingStep(1, "active");
      const recent = await fetchRecent(ticker, scenario);
      updateLoadingStep(1, "completed");

      // 2) metrics (DA)
      updateLoadingStep(2, "active");
      let da = null;
      try {
        const met = await fetchMetrics(ticker, scenario, model_type);
        if (met && Array.isArray(met.results) && met.results.length) {
          // API returns DA already rounded to 2 decimals
          da = Number(met.results[0].DA);
        }
      } catch (e) {
        da = null;
      }
      updateLoadingStep(2, "completed");

      // 3) inference
      updateLoadingStep(3, "active");
      const infer = await fetchInfer(ticker, scenario, model_type);
      updateLoadingStep(3, "completed");

      // ensure minimum display time (smooth loading)
      const elapsed = Date.now() - startTime;
      if (elapsed < minDisplayTime) {
        await new Promise((r) => setTimeout(r, minDisplayTime - elapsed));
      }

      const closes = (recent && Array.isArray(recent.close)) ? recent.close.map(Number) : [];
      const dates = (recent && Array.isArray(recent.dates)) ? recent.dates : [];

      const predPrices = (infer && Array.isArray(infer.pred_prices)) ? infer.pred_prices.map(Number) : [];
      const horizon = predPrices.length || 5;

      const lastDate = dates.length ? dates[dates.length - 1] : null;
      const forecastDates = lastDate ? Array.from({ length: horizon }, (_, i) => addDaysISO(lastDate, i + 1)) : Array.from({ length: horizon }, (_, i) => `t+${i + 1}`);

      // Header + model details
      updateHeader(ticker, dates, forecastDates);
      updateModelDetails(scenario, model_type, da);

      // predicted price (step +5)
      const lastPred = predPrices.length ? predPrices[predPrices.length - 1] : null;
      document.querySelector(".price-value").textContent =
        typeof lastPred === "number" && !Number.isNaN(lastPred) ? lastPred.toFixed(2) : "-";

      // details panel
      const detailsDiv = document.getElementById("predictionDetails");
      const directionValue = document.getElementById("directionValue");
      const currentPriceValue = document.getElementById("currentPriceValue");
      const confidenceValue = document.getElementById("confidenceValue");

      const lastClose = closes.length ? closes[closes.length - 1] : (infer && typeof infer.last_close === "number" ? infer.last_close : null);
      if (typeof lastClose === "number" && !Number.isNaN(lastClose)) {
        currentPriceValue.textContent = lastClose.toFixed(2);
      } else {
        currentPriceValue.textContent = "-";
      }

      // direction based on step+5 vs current
      if (typeof lastClose === "number" && !Number.isNaN(lastClose) && typeof lastPred === "number" && !Number.isNaN(lastPred)) {
        const dir = lastPred >= lastClose ? "UP" : "DOWN";
        directionValue.textContent = dir;
        directionValue.style.color = dir === "UP" ? "#22c55e" : "#ef4444";
      } else {
        directionValue.textContent = "-";
        directionValue.style.color = "";
      }

      confidenceValue.textContent =
        typeof da === "number" && !Number.isNaN(da) ? `${da.toFixed(2)}%` : "-";

      detailsDiv.style.display = "block";

      // Chart buffers
      stockData.length = 0;
      predictionData.length = 0;

      const ohlc = toOHLCFromCloses(closes);
      ohlc.forEach((d) => stockData.push(d));

      // align prediction times: last historical index is 19 (t), predictions start at 20 (+1)
      const baseT = Math.max(0, stockData.length - 1);
      predPrices.forEach((p, i) => predictionData.push({ time: baseT + (i + 1), price: p }));

      chart.setMode(chartType);
      chart.render();

      // Table: last 20 + forecast 5
      renderSeriesTable(dates, closes, forecastDates, predPrices);
    } catch (error) {
      console.error("Prediction error:", error);
      alert(`Error: ${error.message}`);
    } finally {
      hideLoadingScreen();
      button.disabled = false;
      button.textContent = originalText;
    }
  });
});
