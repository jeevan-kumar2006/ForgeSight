const MACHINE_IDS = ["CNC_01", "CNC_02", "PUMP_03", "CONVEYOR_04"];
const MACHINE_NAMES = {
  CNC_01: "CNC Machine #1",
  CNC_02: "CNC Machine #2",
  PUMP_03: "Pump #3",
  CONVEYOR_04: "Conveyor #4",
};

const METRIC_LABEL = {
  temperature_C: "Temperature (deg C)",
  vibration_mm_s: "Vibration (mm/s)",
  rpm: "RPM",
  current_A: "Current (A)",
};

let cache = {};
let refreshInProgress = false;

function downsample(series, maxPoints = 260) {
  if (series.length <= maxPoints) return series;
  const step = series.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(series[Math.floor(i * step)]);
  }
  return out;
}

function ewma(series, alpha = 0.22) {
  if (!series.length) return [];
  let prev = series[0];
  const out = [prev];
  for (let i = 1; i < series.length; i += 1) {
    prev = alpha * series[i] + (1 - alpha) * prev;
    out.push(prev);
  }
  return out;
}

function rollingMedian(series, window = 5) {
  const out = [];
  for (let i = 0; i < series.length; i += 1) {
    const start = Math.max(0, i - Math.floor(window / 2));
    const end = Math.min(series.length, i + Math.floor(window / 2) + 1);
    const seg = series.slice(start, end).sort((a, b) => a - b);
    out.push(seg[Math.floor(seg.length / 2)]);
  }
  return out;
}

function detectFalseSpikes(raw, filtered) {
  if (!raw.length) return [];
  const diffs = raw.map((v, i) => Math.abs(v - filtered[i]));
  const mean = diffs.reduce((s, v) => s + v, 0) / diffs.length;
  const variance = diffs.reduce((s, v) => s + (v - mean) ** 2, 0) / diffs.length;
  const std = Math.sqrt(variance) || 0;
  const threshold = mean + std * 2.1;
  return diffs.map((d, idx) => (d > threshold ? idx : -1)).filter((idx) => idx >= 0);
}

function renderChart(svg, raw, filtered, aiSignal, spikeIndexes, showSpikes) {
  const width = 860;
  const height = 215;
  const pad = 18;
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";

  if (!raw.length) return;

  const all = [...raw, ...filtered, ...aiSignal];
  const min = Math.min(...all);
  const max = Math.max(...all);
  const span = max - min || 1;

  const toPoint = (value, idx, n) => {
    const x = pad + (idx / Math.max(1, n - 1)) * (width - pad * 2);
    const y = pad + ((max - value) / span) * (height - pad * 2);
    return { x, y };
  };

  [0.2, 0.5, 0.8].forEach((ratio) => {
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    const y = pad + (height - pad * 2) * ratio;
    line.setAttribute("x1", `${pad}`);
    line.setAttribute("y1", `${y}`);
    line.setAttribute("x2", `${width - pad}`);
    line.setAttribute("y2", `${y}`);
    line.setAttribute("stroke", "rgba(255,255,255,0.08)");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
  });

  const drawLine = (series, color, widthPx, opacity = 1) => {
    const poly = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
    poly.setAttribute("fill", "none");
    poly.setAttribute("stroke", color);
    poly.setAttribute("stroke-width", `${widthPx}`);
    poly.setAttribute("opacity", `${opacity}`);
    poly.setAttribute("stroke-linecap", "round");
    poly.setAttribute("stroke-linejoin", "round");
    poly.setAttribute(
      "points",
      series.map((v, idx) => {
        const p = toPoint(v, idx, series.length);
        return `${p.x},${p.y}`;
      }).join(" ")
    );
    svg.appendChild(poly);
  };

  drawLine(raw, "#8b9ab3", 1.2, 0.55);
  drawLine(filtered, "#00f5c4", 2.1, 0.95);
  drawLine(aiSignal, "#ffc107", 2.3, 0.98);

  if (showSpikes) {
    spikeIndexes.forEach((idx) => {
      const p = toPoint(raw[idx], idx, raw.length);
      const mark = document.createElementNS("http://www.w3.org/2000/svg", "circle");
      mark.setAttribute("cx", `${p.x}`);
      mark.setAttribute("cy", `${p.y}`);
      mark.setAttribute("r", "2.8");
      mark.setAttribute("fill", "#ff4060");
      svg.appendChild(mark);
    });
  }
}

function createCard(mid) {
  const card = document.createElement("article");
  card.className = "nf-card";
  card.id = `nf-card-${mid}`;
  card.innerHTML = `
    <div class="nf-head">
      <h3>${MACHINE_NAMES[mid]}</h3>
      <span id="nf-head-${mid}">Loading...</span>
    </div>
    <svg id="nf-chart-${mid}" class="nf-canvas" preserveAspectRatio="none"></svg>
    <div class="nf-foot">
      <span id="nf-spikes-${mid}">False spikes removed: -</span>
      <span id="nf-latest-${mid}">Latest: -</span>
    </div>
  `;
  return card;
}

function setText(id, text) {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function renderNoiseView() {
  const metric = document.getElementById("nf-metric").value;
  const showSpikes = document.getElementById("show-false-spikes").checked;

  MACHINE_IDS.forEach((mid) => {
    const rows = cache[mid] || [];
    const raw = downsample(rows.map((r) => Number(r[metric]) || 0));
    const filtered = ewma(rollingMedian(raw, 5), 0.25);
    const aiSignal = ewma(filtered, 0.12);
    const spikes = detectFalseSpikes(raw, filtered);

    const svg = document.getElementById(`nf-chart-${mid}`);
    renderChart(svg, raw, filtered, aiSignal, spikes, showSpikes);

    const latest = raw.length ? raw[raw.length - 1] : 0;
    const percent = raw.length ? ((spikes.length / raw.length) * 100).toFixed(1) : "0.0";
    setText(`nf-head-${mid}`, METRIC_LABEL[metric]);
    setText(`nf-spikes-${mid}`, `False spikes removed: ${spikes.length} (${percent}%)`);
    setText(`nf-latest-${mid}`, `Latest raw/AI: ${latest.toFixed(2)} / ${(aiSignal[aiSignal.length - 1] || 0).toFixed(2)}`);
  });

  setText("nf-refresh-time", `Last refresh: ${new Date().toLocaleTimeString()}`);
}

async function loadHistoryData() {
  if (refreshInProgress) return;
  refreshInProgress = true;
  const refreshBtn = document.getElementById("nf-refresh");
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing...";
  }

  const responses = await Promise.all(
    MACHINE_IDS.map((mid) => fetch(`/history/${mid}`, { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error(`Failed to load history for ${mid}`);
      return res.json();
    }))
  );

  MACHINE_IDS.forEach((mid, idx) => {
    cache[mid] = responses[idx];
  });

  if (refreshBtn) {
    refreshBtn.disabled = false;
    refreshBtn.textContent = "Updated";
    setTimeout(() => {
      refreshBtn.textContent = "Refresh";
    }, 900);
  }
  refreshInProgress = false;
}

async function bootstrap() {
  const grid = document.getElementById("nf-grid");
  MACHINE_IDS.forEach((mid) => grid.appendChild(createCard(mid)));

  document.getElementById("nf-metric").addEventListener("change", renderNoiseView);
  document.getElementById("show-false-spikes").addEventListener("change", renderNoiseView);
  document.getElementById("nf-refresh").addEventListener("click", async () => {
    try {
      await loadHistoryData();
      renderNoiseView();
    } catch (err) {
      setText("nf-refresh-time", `Refresh error: ${err.message}`);
      const refreshBtn = document.getElementById("nf-refresh");
      if (refreshBtn) {
        refreshBtn.disabled = false;
        refreshBtn.textContent = "Refresh";
      }
      refreshInProgress = false;
    }
  });

  await loadHistoryData();
  renderNoiseView();
}

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((err) => {
    setText("nf-refresh-time", `Startup error: ${err.message}`);
  });
});
