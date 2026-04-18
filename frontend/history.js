const MACHINE_IDS = ["CNC_01", "CNC_02", "PUMP_03", "CONVEYOR_04"];
const MACHINE_NAMES = {
  CNC_01: "CNC Machine #1",
  CNC_02: "CNC Machine #2",
  PUMP_03: "Pump #3",
  CONVEYOR_04: "Conveyor #4",
};

const METRIC_META = {
  temperature_C: { label: "Temperature", unit: "deg C", color: "#60a5fa" },
  vibration_mm_s: { label: "Vibration", unit: "mm/s", color: "#00f5c4" },
  rpm: { label: "RPM", unit: "rpm", color: "#ffc107" },
  current_A: { label: "Current", unit: "A", color: "#ff4060" },
};

let historyCache = {};
let trendLoading = false;

function mergeLiveSamples(liveMachines) {
  if (!Array.isArray(liveMachines)) return;
  liveMachines.forEach((m) => {
    const mid = m.machine_id;
    if (!mid || !Array.isArray(historyCache[mid])) return;
    const row = {
      machine_id: mid,
      timestamp: m.timestamp || new Date().toISOString(),
      temperature_C: Number(m.temperature_C),
      vibration_mm_s: Number(m.vibration_mm_s),
      rpm: Number(m.rpm),
      current_A: Number(m.current_A),
      status: m.status || "running",
    };
    if (![row.temperature_C, row.vibration_mm_s, row.rpm, row.current_A].every(Number.isFinite)) {
      return;
    }

    const arr = historyCache[mid];
    const lastTs = arr.length ? new Date(arr[arr.length - 1].timestamp).getTime() : 0;
    const nextTs = new Date(row.timestamp).getTime();
    if (nextTs > lastTs) {
      arr.push(row);
      if (arr.length > 10081) arr.shift();
    }
  });
}

const FALLBACK_BASELINES = {
  CNC_01: { temperature_C: 72, vibration_mm_s: 1.8, rpm: 1480, current_A: 12.5 },
  CNC_02: { temperature_C: 68, vibration_mm_s: 1.5, rpm: 1490, current_A: 11.8 },
  PUMP_03: { temperature_C: 55, vibration_mm_s: 2.2, rpm: 2950, current_A: 18 },
  CONVEYOR_04: { temperature_C: 45, vibration_mm_s: 0.9, rpm: 720, current_A: 8.5 },
};

function generateFallbackHistory(machineId, sampleCount = 1440) {
  const baseline = FALLBACK_BASELINES[machineId] || FALLBACK_BASELINES.CNC_01;
  const rows = [];
  const start = Date.now() - sampleCount * 60_000;

  for (let i = 0; i < sampleCount; i += 1) {
    const t = start + i * 60_000;
    const wave = Math.sin(i / 38) * 0.6 + Math.cos(i / 87) * 0.35;
    const drift = i / sampleCount;
    rows.push({
      machine_id: machineId,
      timestamp: new Date(t).toISOString(),
      temperature_C: Number((baseline.temperature_C + wave * 2 + drift * 4).toFixed(2)),
      vibration_mm_s: Number((baseline.vibration_mm_s + wave * 0.18 + drift * 0.7).toFixed(3)),
      rpm: Number((baseline.rpm + Math.sin(i / 55) * 22 - drift * 35).toFixed(0)),
      current_A: Number((baseline.current_A + wave * 0.45 + drift * 0.9).toFixed(2)),
    });
  }

  return rows;
}

function setText(id, value) {
  const el = document.getElementById(id);
  if (el) el.textContent = value;
}

function formatDate(value) {
  return new Date(value).toLocaleString();
}

function downsample(series, maxPoints = 260) {
  if (series.length <= maxPoints) return series;
  const step = series.length / maxPoints;
  const out = [];
  for (let i = 0; i < maxPoints; i += 1) {
    out.push(series[Math.floor(i * step)]);
  }
  return out;
}

function movingAverage(series, window = 9) {
  if (!series.length) return series;
  const out = [];
  for (let i = 0; i < series.length; i += 1) {
    const start = Math.max(0, i - window + 1);
    const seg = series.slice(start, i + 1);
    const avg = seg.reduce((sum, row) => sum + row.value, 0) / seg.length;
    out.push({ timestamp: series[i].timestamp, value: avg });
  }
  return out;
}

function renderLineChart(svg, series, color) {
  const width = 860;
  const height = 220;
  const pad = 18;

  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.innerHTML = "";

  if (!series.length) return;

  const values = series.map((row) => row.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;

  const pts = series.map((row, idx) => {
    const x = pad + (idx / Math.max(1, series.length - 1)) * (width - pad * 2);
    const y = pad + ((max - row.value) / span) * (height - pad * 2);
    return { x, y };
  });

  [0.2, 0.5, 0.8].forEach((ratio) => {
    const y = pad + (height - pad * 2) * ratio;
    const line = document.createElementNS("http://www.w3.org/2000/svg", "line");
    line.setAttribute("x1", `${pad}`);
    line.setAttribute("y1", `${y}`);
    line.setAttribute("x2", `${width - pad}`);
    line.setAttribute("y2", `${y}`);
    line.setAttribute("stroke", "rgba(255,255,255,0.08)");
    line.setAttribute("stroke-width", "1");
    svg.appendChild(line);
  });

  const pathLine = document.createElementNS("http://www.w3.org/2000/svg", "polyline");
  pathLine.setAttribute("fill", "none");
  pathLine.setAttribute("stroke", color);
  pathLine.setAttribute("stroke-width", "2.8");
  pathLine.setAttribute("stroke-linecap", "round");
  pathLine.setAttribute("stroke-linejoin", "round");
  pathLine.setAttribute("points", pts.map((p) => `${p.x},${p.y}`).join(" "));

  const area = document.createElementNS("http://www.w3.org/2000/svg", "path");
  const areaPath = [
    `M ${pad} ${height - pad}`,
    ...pts.map((p, i) => `${i === 0 ? "L" : "L"} ${p.x} ${p.y}`),
    `L ${width - pad} ${height - pad}`,
    "Z",
  ].join(" ");
  area.setAttribute("d", areaPath);
  area.setAttribute("fill", `${color}22`);

  const marker = document.createElementNS("http://www.w3.org/2000/svg", "circle");
  const last = pts[pts.length - 1];
  marker.setAttribute("cx", `${last.x}`);
  marker.setAttribute("cy", `${last.y}`);
  marker.setAttribute("r", "3.6");
  marker.setAttribute("fill", color);

  svg.appendChild(area);
  svg.appendChild(pathLine);
  svg.appendChild(marker);
}

function buildChartCard(mid) {
  const card = document.createElement("article");
  card.className = "chart-card";
  card.id = `history-card-${mid}`;
  card.innerHTML = `
    <div class="chart-head">
      <h3>${MACHINE_NAMES[mid]}</h3>
      <span id="head-${mid}">Loading...</span>
    </div>
    <svg id="chart-${mid}" class="chart-canvas" preserveAspectRatio="none"></svg>
    <div class="chart-foot">
      <span id="range-${mid}">Range: -</span>
      <span id="latest-${mid}">Latest: -</span>
    </div>
  `;
  return card;
}

function renderHistory(metric) {
  const meta = METRIC_META[metric];
  const allRows = Object.values(historyCache).flat();
  if (!allRows.length) return;

  const sortedAll = allRows.slice().sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));
  const start = sortedAll[0].timestamp;
  const end = sortedAll[sortedAll.length - 1].timestamp;
  setText("window-range", `${formatDate(start)} to ${formatDate(end)}`);
  setText("sample-count", `${historyCache[MACHINE_IDS[0]]?.length || 0}`);
  setText("last-refresh", new Date().toLocaleTimeString());

  MACHINE_IDS.forEach((mid) => {
    const rows = historyCache[mid] || [];
    const series = rows.map((r) => ({ timestamp: r.timestamp, value: Number(r[metric]) || 0 }));
    const sampled = downsample(series);
    const smoothed = movingAverage(sampled, 10);

    const svg = document.getElementById(`chart-${mid}`);
    renderLineChart(svg, smoothed, meta.color);

    const values = series.map((r) => r.value);
    const min = values.length ? Math.min(...values) : 0;
    const max = values.length ? Math.max(...values) : 0;
    const latest = values.length ? values[values.length - 1] : 0;
    const mean = values.length ? values.reduce((sum, v) => sum + v, 0) / values.length : 0;

    setText(`head-${mid}`, `${meta.label} trend (${meta.unit})`);
    setText(`range-${mid}`, `Normal range seen: ${min.toFixed(2)} to ${max.toFixed(2)} ${meta.unit}`);
    setText(`latest-${mid}`, `Latest: ${latest.toFixed(2)} ${meta.unit} | Avg: ${mean.toFixed(2)}`);
  });
}

async function loadHistory() {
  if (trendLoading) return;
  trendLoading = true;
  const refreshBtn = document.getElementById("refresh-history");
  if (refreshBtn) {
    refreshBtn.disabled = true;
    refreshBtn.textContent = "Refreshing...";
  }

  const metric = document.getElementById("metric-select").value;
  const requests = MACHINE_IDS.map((mid) =>
    fetch(`/history/${mid}`, { cache: "no-store" }).then((res) => {
      if (!res.ok) throw new Error(`History fetch failed for ${mid}`);
      return res.json();
    })
  );

  try {
    const responses = await Promise.all(requests);
    MACHINE_IDS.forEach((mid, idx) => {
      historyCache[mid] = responses[idx];
    });

    try {
      const liveResp = await fetch(`/api/live-state?t=${Date.now()}`, { cache: "no-store" });
      if (liveResp.ok) {
        const payload = await liveResp.json();
        mergeLiveSamples(payload.machines || []);
      }
    } catch (_) {}
  } catch (err) {
    MACHINE_IDS.forEach((mid) => {
      historyCache[mid] = generateFallbackHistory(mid);
    });
    setText("window-range", `Using local demo data because the backend was unavailable`);
  } finally {
    renderHistory(metric);
    if (refreshBtn) {
      refreshBtn.textContent = "Trends Updated";
      setTimeout(() => {
        refreshBtn.textContent = "Refresh Trends";
      }, 900);
      refreshBtn.disabled = false;
    }
    trendLoading = false;
  }
}

async function bootstrap() {
  const grid = document.getElementById("chart-grid");
  MACHINE_IDS.forEach((mid) => grid.appendChild(buildChartCard(mid)));

  document.getElementById("metric-select").addEventListener("change", () => {
    const metric = document.getElementById("metric-select").value;
    renderHistory(metric);
  });

  document.getElementById("refresh-history").addEventListener("click", async () => {
    try {
      await loadHistory();
    } catch (err) {
      setText("window-range", `History load error: ${err.message}`);
    }
  });

  await loadHistory();
}

document.addEventListener("DOMContentLoaded", () => {
  bootstrap().catch((err) => {
    setText("window-range", `Startup error: ${err.message}`);
  });
});
