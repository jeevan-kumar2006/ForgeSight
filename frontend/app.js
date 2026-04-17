const MACHINE_IDS = ['CNC_01', 'CNC_02', 'PUMP_03', 'CONVEYOR_04'];
const MACHINE_NAMES = { 'CNC_01': 'CNC Machine #1', 'CNC_02': 'CNC Machine #2', 'PUMP_03': 'Pump #3', 'CONVEYOR_04': 'Conveyor #4' };
const SENSOR_RANGES = {
    temperature_C: { min: 0, max: 120, unit: '°C', label: 'Temp' },
    vibration_mm_s: { min: 0, max: 18, unit: 'mm/s', label: 'Vibration' },
    rpm: { min: 0, max: 3500, unit: 'RPM', label: 'RPM' },
    current_A: { min: 0, max: 30, unit: 'A', label: 'Current' },
};
const SENSOR_FIELDS = ['temperature_C', 'vibration_mm_s', 'rpm', 'current_A'];
const MAX_HISTORY = 36;
const SPARK_WIDTH = 240;
const SPARK_HEIGHT = 72;
const SPARK_MARGIN = 12;

const machineState = {}; 
MACHINE_IDS.forEach(mid => {
    machineState[mid] = {
        riskScore: 0,
        status: 'running',
        readings: {},
        baselines: {},
        anomalies: {},
        dataGap: false,
        anomalyType: 'none',
        suppressed: 0,
        history: {
            risk: [],
            temperature_C: [],
            vibration_mm_s: [],
            rpm: [],
            current_A: [],
        },
    };
});

let alerts = [];
let priorityQueue = [];
let maintenanceSlots = [];
let prevPriorities = {};
let sseConnected = false;
let aiInsights = [];

function simplifyReason(text) {
    if (!text) return 'No details available';
    return String(text)
        .replace(/\[(SPIKE|DRIFT|COMPOUND|NONE)\]\s*/gi, '')
        .replace(/sensor\(s\) anomalous/gi, 'sensors outside safe range')
        .replace(/\s+/g, ' ')
        .trim();
}

function truncateText(text, maxLen = 180) {
    if (!text) return '';
    return text.length > maxLen ? `${text.slice(0, maxLen).trimEnd()}...` : text;
}

function summarizeMachineState(st) {
    if (st.dataGap) return 'No live signal from this machine right now';
    if (st.anomalyType === 'compound') return 'Multiple abnormal patterns need immediate attention';
    if (st.anomalyType === 'spike') return 'Sudden jump detected, watch closely';
    if (st.anomalyType === 'drift') return 'Gradual drift detected, plan inspection';
    if (st.riskScore >= 75) return 'Critical risk, intervention required now';
    if (st.riskScore >= 50) return 'High risk, schedule maintenance soon';
    if (st.riskScore >= 25) return 'Moderate risk, monitor trend';
    return 'Stable operation';
}

function initMachineCards() {
    const grid = document.getElementById('machines-grid');
    MACHINE_IDS.forEach(mid => {
        const card = document.createElement('div');
        card.id = `card-${mid}`;
        card.className = 'machine-card risk-low';
        card.innerHTML = `
            <div class="card-header">
                <div>
                    <h3>${mid}</h3>
                    <div class="machine-name">${MACHINE_NAMES[mid]}</div>
                </div>
                <span id="status-${mid}" class="badge badge-running">RUNNING</span>
            </div>
            <div class="risk-gauge-row">
                <div class="risk-gauge" id="gauge-${mid}">
                    <div class="risk-gauge-bg"></div>
                    <span class="risk-gauge-value" id="gauge-val-${mid}">0</span>
                </div>
                <div class="risk-label">
                    <strong>Risk Score</strong>
                    <span id="risk-class-${mid}">Normal</span>
                </div>
            </div>
            <div class="quick-summary" id="summary-${mid}">Stable operation</div>
            <div class="graph-card">
                <div class="spark-wrap">
                    <div class="spark-label">Risk trend (last 36 sec)</div>
                    <div class="spark-legend">
                        <span><i class="legend-dot legend-current"></i>Current</span>
                        <span><i class="legend-dot legend-average"></i>Average</span>
                    </div>
                    <svg class="spark-canvas" id="spark-${mid}" viewBox="0 0 240 72" preserveAspectRatio="none"></svg>
                </div>
                <div class="data-stats" id="stats-${mid}">
                    <div class="stat-item">
                        <span class="stat-label">Min</span>
                        <span class="stat-value" id="stat-min-${mid}">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Max</span>
                        <span class="stat-value" id="stat-max-${mid}">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Avg</span>
                        <span class="stat-value" id="stat-avg-${mid}">0</span>
                    </div>
                    <div class="stat-item">
                        <span class="stat-label">Now</span>
                        <span class="stat-value" id="stat-current-${mid}">0</span>
                    </div>
                </div>
            </div>
            <div id="atype-${mid}" class="anomaly-type-badge at-none"></div>
            <div class="sensor-rows" id="sensors-${mid}">
                ${SENSOR_FIELDS.map(f => `
                    <div class="sensor-row">
                        <span class="sensor-label">${SENSOR_RANGES[f].label}</span>
                        <span class="sensor-value" id="val-${mid}-${f}">--</span>
                        <div class="sensor-bar-track" id="bar-${mid}-${f}">
                            <div class="sensor-bar-safe"></div>
                            <div class="sensor-bar-dot"></div>
                        </div>
                    </div>
                `).join('')}
            </div>
            <div class="data-gap-overlay" id="gap-${mid}">DATA GAP — NO SIGNAL</div>
        `;
        grid.appendChild(card);
    });
}

function riskClass(score) { return score > 75 ? 'critical' : score > 50 ? 'high' : score > 25 ? 'medium' : score > 10 ? 'low' : 'normal'; }
function riskLabel(cls) { return { normal: 'Normal', low: 'Low', medium: 'Moderate', high: 'High', critical: 'Critical' }[cls] || 'Normal'; }
function riskColor(cls) { return { normal: 'var(--green)', low: 'var(--green)', medium: 'var(--yellow)', high: 'var(--orange)', critical: 'var(--red)' }[cls] || 'var(--green)'; }

function normalizeHistory(values, width, height, margin) {
    if (!values.length) return '';
    const min = Math.min(...values);
    const max = Math.max(...values);
    const span = max - min || 1;
    const availableHeight = height - margin * 2;
    const availableWidth = width - margin * 2;
    return values.map((value, index) => {
        const x = margin + (index / Math.max(1, values.length - 1)) * availableWidth;
        const y = margin + ((max - value) / span) * availableHeight;
        return `${x},${y}`;
    }).join(' ');
}

function updateSparkline(mid) {
    const svg = document.getElementById(`spark-${mid}`);
    const history = machineState[mid].history.risk;
    if (!svg) return;
    svg.innerHTML = '';

    const baseline = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    baseline.setAttribute('x1', `${SPARK_MARGIN}`);
    baseline.setAttribute('y1', `${SPARK_HEIGHT - SPARK_MARGIN}`);
    baseline.setAttribute('x2', `${SPARK_WIDTH - SPARK_MARGIN}`);
    baseline.setAttribute('y2', `${SPARK_HEIGHT - SPARK_MARGIN}`);
    baseline.setAttribute('stroke', 'rgba(255,255,255,0.08)');
    baseline.setAttribute('stroke-width', '1');
    svg.appendChild(baseline);

    if (history.length < 2) {
        const line = document.createElementNS('http://www.w3.org/2000/svg', 'line');
        line.setAttribute('x1', `${SPARK_MARGIN}`);
        line.setAttribute('y1', `${SPARK_HEIGHT / 2}`);
        line.setAttribute('x2', `${SPARK_WIDTH - SPARK_MARGIN}`);
        line.setAttribute('y2', `${SPARK_HEIGHT / 2}`);
        line.setAttribute('stroke', 'rgba(90,106,132,0.45)');
        line.setAttribute('stroke-width', '2');
        svg.appendChild(line);
        return;
    }

    const pathData = normalizeHistory(history, SPARK_WIDTH, SPARK_HEIGHT, SPARK_MARGIN);
    const polyline = document.createElementNS('http://www.w3.org/2000/svg', 'polyline');
    polyline.setAttribute('points', pathData);
    polyline.setAttribute('fill', 'none');
    polyline.setAttribute('stroke', 'rgba(0,245,196,0.98)');
    polyline.setAttribute('stroke-width', '3');
    polyline.setAttribute('stroke-linecap', 'round');
    polyline.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(polyline);

    const min = Math.min(...history);
    const max = Math.max(...history);
    const span = max - min || 1;
    const linePoints = history.map((value, index) => {
        const x = SPARK_MARGIN + (index / Math.max(1, history.length - 1)) * (SPARK_WIDTH - SPARK_MARGIN * 2);
        const y = SPARK_MARGIN + ((max - value) / span) * (SPARK_HEIGHT - SPARK_MARGIN * 2);
        return `${x},${y}`;
    }).join(' L ');

    const area = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    area.setAttribute('d', `M ${SPARK_MARGIN} ${SPARK_HEIGHT - SPARK_MARGIN} L ${linePoints} L ${SPARK_WIDTH - SPARK_MARGIN} ${SPARK_HEIGHT - SPARK_MARGIN} Z`);
    area.setAttribute('fill', 'rgba(0,245,196,0.16)');
    svg.insertBefore(area, polyline);

    const avg = history.reduce((a, b) => a + b, 0) / history.length;
    const avgY = SPARK_MARGIN + ((max - avg) / span) * (SPARK_HEIGHT - SPARK_MARGIN * 2);
    const avgLine = document.createElementNS('http://www.w3.org/2000/svg', 'line');
    avgLine.setAttribute('x1', `${SPARK_MARGIN}`);
    avgLine.setAttribute('y1', `${avgY}`);
    avgLine.setAttribute('x2', `${SPARK_WIDTH - SPARK_MARGIN}`);
    avgLine.setAttribute('y2', `${avgY}`);
    avgLine.setAttribute('stroke', 'rgba(255,193,7,0.85)');
    avgLine.setAttribute('stroke-width', '1.4');
    avgLine.setAttribute('stroke-dasharray', '3 4');
    svg.appendChild(avgLine);

    const lastVal = history[history.length - 1];
    const lastX = SPARK_MARGIN + (SPARK_WIDTH - SPARK_MARGIN * 2);
    const lastY = SPARK_MARGIN + ((max - lastVal) / span) * (SPARK_HEIGHT - SPARK_MARGIN * 2);
    const marker = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
    marker.setAttribute('cx', `${lastX}`);
    marker.setAttribute('cy', `${lastY}`);
    marker.setAttribute('r', '3.2');
    marker.setAttribute('fill', '#00f5c4');
    marker.setAttribute('stroke', 'rgba(0,0,0,0.55)');
    marker.setAttribute('stroke-width', '1.2');
    svg.appendChild(marker);
}

function appendHistory(mid) {
    const st = machineState[mid];
    if (!st) return;
    st.history.risk.push(st.riskScore);
    if (st.history.risk.length > MAX_HISTORY) st.history.risk.shift();
    SENSOR_FIELDS.forEach(field => {
        const value = st.readings[field];
        if (value != null) {
            st.history[field].push(value);
            if (st.history[field].length > MAX_HISTORY) st.history[field].shift();
        }
    });
}

function updateDataStats(mid) {
    const st = machineState[mid];
    const history = st.history.risk;
    
    if (history.length === 0) {
        document.getElementById(`stat-min-${mid}`).textContent = '0';
        document.getElementById(`stat-max-${mid}`).textContent = '0';
        document.getElementById(`stat-avg-${mid}`).textContent = '0';
        document.getElementById(`stat-current-${mid}`).textContent = '0';
        return;
    }
    
    const min = Math.min(...history);
    const max = Math.max(...history);
    const avg = Math.round(history.reduce((a, b) => a + b, 0) / history.length);
    const current = st.riskScore;
    
    document.getElementById(`stat-min-${mid}`).textContent = Math.round(min);
    document.getElementById(`stat-max-${mid}`).textContent = Math.round(max);
    document.getElementById(`stat-avg-${mid}`).textContent = avg;
    document.getElementById(`stat-current-${mid}`).textContent = Math.round(current);
}

function updateMachineCard(mid) {
    const st = machineState[mid];
    const cls = riskClass(st.riskScore);
    const card = document.getElementById(`card-${mid}`);
    card.className = `machine-card risk-${cls}` + (st.dataGap ? ' data-gap' : '');

    const statusEl = document.getElementById(`status-${mid}`);
    statusEl.className = `badge badge-${st.status}`;
    statusEl.textContent = st.status.toUpperCase();

    const gauge = document.getElementById(`gauge-${mid}`);
    const pct = Math.min(st.riskScore, 100);
    gauge.style.setProperty('--gauge-pct', pct);
    gauge.style.setProperty('--gauge-color', riskColor(cls));
    document.getElementById(`gauge-val-${mid}`).textContent = Math.round(pct);
    document.getElementById(`gauge-val-${mid}`).style.color = riskColor(cls);
    document.getElementById(`risk-class-${mid}`).textContent = riskLabel(cls);
    document.getElementById(`risk-class-${mid}`).style.color = riskColor(cls);
    document.getElementById(`summary-${mid}`).textContent = summarizeMachineState(st);

    // Anomaly Type Badge
    const atypeEl = document.getElementById(`atype-${mid}`);
    const typeMap = { spike: 'Spike Detected', drift: 'Gradual Drift', compound: 'Compound Anomaly', none: 'Stable' };
    const classMap = { spike: 'at-spike', drift: 'at-drift', compound: 'at-compound', none: 'at-none' };
    atypeEl.textContent = typeMap[st.anomalyType] || 'Stable';
    atypeEl.className = `anomaly-type-badge ${classMap[st.anomalyType] || 'at-none'}`;

    appendHistory(mid);
    updateSparkline(mid);
    updateDataStats(mid);

    SENSOR_FIELDS.forEach(f => {
        const range = SENSOR_RANGES[f];
        const val = st.readings[f];
        const bl = st.baselines[f];
        const isAnomalous = !!st.anomalies[f];

        const valEl = document.getElementById(`val-${mid}-${f}`);
        valEl.textContent = val != null ? `${val.toFixed(range.label === 'RPM' ? 0 : 1)}${range.unit}` : '--';
        valEl.className = 'sensor-value' + (isAnomalous ? ' anomalous' : '');

        const bar = document.getElementById(`bar-${mid}-${f}`);
        const safeBar = bar.querySelector('.sensor-bar-safe');
        const dot = bar.querySelector('.sensor-bar-dot');

        if (bl && val != null) {
            const totalRange = range.max - range.min;
            const safeLeft = Math.max(0, ((bl.lower - range.min) / totalRange) * 100);
            const safeWidth = Math.max(0, ((bl.upper - bl.lower) / totalRange) * 100);
            const valPos = Math.max(0, Math.min(100, ((val - range.min) / totalRange) * 100));
            safeBar.style.left = safeLeft + '%';
            safeBar.style.width = safeWidth + '%';
            dot.style.left = valPos + '%';
            dot.className = 'sensor-bar-dot' + (isAnomalous ? ' anomalous' : '');
        }
    });
    document.getElementById(`gap-${mid}`).style.display = st.dataGap ? 'flex' : 'none';
}

function updatePriorityQueue() {
    const container = document.getElementById('priority-queue');
    document.getElementById('pq-count').textContent = priorityQueue.length;
    if (!priorityQueue.length) { container.innerHTML = '<p class="empty-state">No escalations</p>'; return; }
    
    container.innerHTML = priorityQueue.map((item, i) => {
        const rankCls = i === 0 ? 'r1' : i === 1 ? 'r2' : i === 2 ? 'r3' : 'rn';
        const scoreColor = riskColor(riskClass(item.risk_score));
        const prevPrio = prevPriorities[item.machine_id];
        const isEscalated = prevPrio && prevPrio !== item.priority && 
                            ['info','low','medium','high','critical'].indexOf(item.priority) > ['info','low','medium','high','critical'].indexOf(prevPrio);
        
        return `
            <div class="pq-item ${isEscalated ? 'escalated' : ''}">
                <span class="pq-rank ${rankCls}">${i + 1}</span>
                <div class="pq-info">
                    <div class="pq-mid">${item.machine_id} ${isEscalated ? '<span class="badge badge-critical" style="font-size:8px">ESCALATED</span>' : ''}</div>
                    <div class="pq-reason">${simplifyReason(item.reason)}</div>
                </div>
                <span class="pq-score" style="color:${scoreColor}">${Math.round(item.risk_score)}</span>
            </div>
        `;
    }).join('');

    priorityQueue.forEach(item => prevPriorities[item.machine_id] = item.priority);
}

function updateMaintenanceSchedule() {
    const container = document.getElementById('maintenance-schedule');
    document.getElementById('maint-count').textContent = maintenanceSlots.length;
    if (!maintenanceSlots.length) { container.innerHTML = '<p class="empty-state">No scheduled slots</p>'; return; }
    container.innerHTML = maintenanceSlots.map(slot => {
        const time = new Date(slot.scheduled_time);
        const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        return `
            <div class="maint-item">
                <span class="maint-icon">&#128295;</span>
                <div class="maint-info">
                    <div class="maint-mid">${slot.machine_id} <span class="badge badge-${slot.priority || 'medium'}">${(slot.priority || 'medium').toUpperCase()}</span></div>
                    <div class="maint-time">Scheduled: ${timeStr}</div>
                    <div class="maint-time">Source: ${(slot.source || 'api').replaceAll('_', ' ')}</div>
                    <div class="maint-reason" title="${slot.reason}">${slot.reason}</div>
                </div>
            </div>
        `;
    }).join('');
}

function updateForwardingSummary(forwarding) {
    const el = document.getElementById('maint-forwarding');
    if (!el) return;
    if (!forwarding) {
        el.textContent = 'Forwarding: waiting for data...';
        return;
    }
    const apiOk = forwarding.api_success || 0;
    const apiFail = forwarding.api_failure || 0;
    const local = forwarding.local_fallback || 0;
    el.textContent = `Forwarding: API success ${apiOk} | API fail ${apiFail} | Local fallback ${local}`;
}

function estimateConfidence(alert) {
    const risk = Number(alert.risk_score || 0);
    if (risk >= 85) return 87;
    if (risk >= 70) return 79;
    if (risk >= 55) return 72;
    if (risk >= 35) return 64;
    return 58;
}

function estimateTTF(alert) {
    const risk = Number(alert.risk_score || 0);
    if (risk >= 90) return '6-10 hours';
    if (risk >= 75) return '12-18 hours';
    if (risk >= 60) return '18-28 hours';
    if (risk >= 40) return '1-2 days';
    return '2-4 days';
}

function deriveRootCause(alert) {
    const sensors = Array.isArray(alert.sensors_affected) ? alert.sensors_affected : [];
    const type = String(alert.anomaly_type || '').toLowerCase();

    if (sensors.includes('vibration_mm_s') && sensors.includes('temperature_C')) {
        return {
            cause: 'Likely bearing wear with heat buildup',
            fix: 'Inspect bearing housing, check lubrication, and align shaft coupling.',
        };
    }
    if (sensors.includes('current_A') && sensors.includes('rpm')) {
        return {
            cause: 'Possible drive load imbalance or motor drag',
            fix: 'Check mechanical drag, inspect belt/gear train, and review motor current profile.',
        };
    }
    if (type === 'drift') {
        return {
            cause: 'Gradual calibration or component wear drift',
            fix: 'Schedule preventive recalibration and inspect wear parts.',
        };
    }
    if (type === 'spike') {
        return {
            cause: 'Intermittent transient stress or unstable load input',
            fix: 'Check upstream load source and verify damping/isolation mounts.',
        };
    }
    return {
        cause: 'Multi-factor anomaly trend requiring inspection',
        fix: 'Run targeted diagnostics on affected sensors and review recent load pattern.',
    };
}

function buildDeltaLines(alert) {
    const mid = alert.machine_id;
    const st = machineState[mid];
    const lines = [];
    if (!st || !st.readings || !st.baselines) return lines;

    const temp = st.readings.temperature_C;
    const tempMean = st.baselines.temperature_C?.mean;
    if (temp != null && tempMean != null && tempMean !== 0) {
        const delta = temp - tempMean;
        lines.push(`Temperature changed by ${delta >= 0 ? '+' : ''}${delta.toFixed(1)} deg C from baseline`);
    }

    const vib = st.readings.vibration_mm_s;
    const vibMean = st.baselines.vibration_mm_s?.mean;
    if (vib != null && vibMean != null && vibMean !== 0) {
        const pct = ((vib - vibMean) / vibMean) * 100;
        lines.push(`Vibration changed by ${pct >= 0 ? '+' : ''}${pct.toFixed(0)}% from baseline`);
    }

    return lines;
}

function addAiInsight(alert) {
    const confidence = estimateConfidence(alert);
    const ttf = estimateTTF(alert);
    const root = deriveRootCause(alert);
    const deltaLines = buildDeltaLines(alert);
    const summary = simplifyReason(alert.reason_summary || 'Pattern anomaly detected');

    const insight = {
        id: alert.alert_id || `${alert.machine_id}-${Date.now()}`,
        machine: alert.machine_id || 'UNKNOWN',
        confidence,
        summary,
        deltaLines,
        cause: root.cause,
        fix: root.fix,
        ttf,
        timestamp: alert.timestamp,
    };

    aiInsights.unshift(insight);
    if (aiInsights.length > 30) aiInsights = aiInsights.slice(0, 30);
    renderAiInsights();
}

function renderAiInsights() {
    const container = document.getElementById('ai-insight-log');
    const countEl = document.getElementById('ai-insight-count');
    if (!container || !countEl) return;

    countEl.textContent = aiInsights.length;
    if (!aiInsights.length) {
        container.innerHTML = '<p class="empty-state">AI insights will appear when alerts are triggered.</p>';
        return;
    }

    container.innerHTML = aiInsights.slice(0, 8).map(item => {
        const timeStr = item.timestamp ? new Date(item.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : '--:--';
        const deltaHtml = item.deltaLines.map(line => `<div class="ai-line">&#9888; ${line}</div>`).join('');
        return `
            <div class="ai-insight-item">
                <div class="ai-head">
                    <span class="ai-title">${item.machine} &middot; ${timeStr}</span>
                    <span class="ai-confidence">Confidence ${item.confidence}%</span>
                </div>
                ${deltaHtml}
                <div class="ai-line">&#129504; Combined pattern: ${item.summary}</div>
                <div class="ai-line">Root cause prediction: ${item.cause}</div>
                <div class="ai-line">Suggested fix: ${item.fix}</div>
                <div class="ai-line">Estimated time-to-failure: ${item.ttf}</div>
            </div>
        `;
    }).join('');
}

function applyLiveMachineData(data) {
    const mid = data.machine_id;
    const st = machineState[mid];
    if (!st) return;
    st.readings = {
        temperature_C: data.temperature_C,
        vibration_mm_s: data.vibration_mm_s,
        rpm: data.rpm,
        current_A: data.current_A,
    };
    st.baselines = data.baselines || {};
    st.anomalies = data.active_anomalies || {};
    st.riskScore = data.risk_score;
    st.status = data.status;
    st.dataGap = !!data.data_gap;
    st.anomalyType = data.anomaly_type || 'none';
    st.suppressed = data.suppressed_spikes || 0;
    updateMachineCard(mid);
}

async function pollLiveState() {
    try {
        const resp = await fetch('/api/live-state');
        if (!resp.ok) return;
        const payload = await resp.json();

        if (!sseConnected && payload.agent_running) {
            const statusEl = document.getElementById('system-status');
            statusEl.textContent = 'ACTIVE';
            statusEl.className = 'status-badge status-active';
        }

        if (Array.isArray(payload.machines) && payload.machines.length) {
            payload.machines.forEach(applyLiveMachineData);
        }

        if (payload.forwarding) updateForwardingSummary(payload.forwarding);
        if (Array.isArray(payload.recent_slots)) {
            maintenanceSlots = payload.recent_slots;
            updateMaintenanceSchedule();
        }
    } catch (_) {}
}

function addAlertItem(alert) {
    alerts.unshift(alert);
    if (alerts.length > 100) alerts = alerts.slice(0, 100);
    document.getElementById('alert-count').textContent = alerts.length;
    const container = document.getElementById('alert-log');
    const empty = container.querySelector('.empty-state');
    if (empty) empty.remove();

    const time = new Date(alert.timestamp);
    const timeStr = time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
    const prioCls = `badge-${alert.priority || 'info'}`;
    const isDataLink = alert.sensors_affected && alert.sensors_affected.includes('_data_link');
    const isLlm = alert.is_llm;
    const summaryText = simplifyReason(alert.reason_summary || 'No reason available');
    const reasoningText = truncateText(simplifyReason(alert.llm_reasoning || alert.reason_summary || 'No reasoning available.'));

    const item = document.createElement('div');
    item.className = 'alert-item';
    item.innerHTML = `
        <div class="alert-meta">
            <span class="alert-time">${timeStr}</span>
            <span class="badge ${prioCls}">${(alert.priority || 'info').toUpperCase()}</span>
            <span class="alert-mid">${alert.machine_id}</span>
            ${isDataLink ? '<span class="badge badge-fault">DATA LINK</span>' : ''}
            <span class="reasoning-tag ${isLlm ? 'tag-ai' : 'tag-rule'}">${isLlm ? 'AI REASONING' : 'RULE-BASED'}</span>
        </div>
        <div class="alert-reason">${summaryText}</div>
        <div class="alert-llm" title="${(alert.llm_reasoning || '').replace(/"/g, '&quot;')}">${reasoningText}</div>
    `;
    container.prepend(item);
    while (container.children.length > 80) container.removeChild(container.lastChild);

    addAiInsight(alert);
}

function connectSSE() {
    const statusEl = document.getElementById('system-status');
    const connEl = document.getElementById('connection-status');
    connEl.className = 'conn-dot connecting';

    const source = new EventSource('/agent/events');

    source.addEventListener('open', () => {
        sseConnected = true;
        connEl.className = 'conn-dot connected';
    });
    source.addEventListener('error', () => {
        sseConnected = false;
        connEl.className = 'conn-dot disconnected';
    });

    source.addEventListener('system', (e) => {
        const data = JSON.parse(e.data);
        if (data.status === 'active') {
            statusEl.textContent = 'ACTIVE';
            statusEl.className = 'status-badge status-active';
            if(data.baseline_samples) document.getElementById('metric-baselines').textContent = `Computed (${data.baseline_samples} samples/machine)`;
        } else {
            statusEl.textContent = 'INITIALIZING';
            statusEl.className = 'status-badge status-init';
        }
    });

    source.addEventListener('heartbeat', (e) => {
        const data = JSON.parse(e.data);
        const u = data.uptime_seconds;
        const h = Math.floor(u / 3600); const m = Math.floor((u % 3600) / 60); const s = u % 60;
        document.getElementById('metric-uptime').textContent = h > 0 ? `${h}h ${m}m` : `${m}m ${s}s`;
        document.getElementById('metric-suppressed').textContent = data.total_suppressed;
        
        const typesEl = document.getElementById('metric-types');
        if (data.active_anomaly_types.length === 0) {
            typesEl.textContent = 'None'; typesEl.style.color = 'var(--green)';
        } else {
            typesEl.innerHTML = data.active_anomaly_types.map(t => `<span class="anomaly-type-badge at-${t}" style="margin:0 2px">${t.toUpperCase()}</span>`).join('');
        }
    });

    source.addEventListener('reading', (e) => {
        const data = JSON.parse(e.data);
        applyLiveMachineData(data);
    });

    source.addEventListener('alert', (e) => {
        const data = JSON.parse(e.data);
        addAlertItem(data);
        if (data.sensors_affected && data.sensors_affected.includes('_data_link')) {
            const mid = data.machine_id;
            if (data.reason_summary.includes('Data gap detected')) machineState[mid].dataGap = true;
            else if (data.reason_summary.includes('restored')) machineState[mid].dataGap = false;
            updateMachineCard(mid);
        }
    });

    source.addEventListener('maintenance', (e) => {
        const data = JSON.parse(e.data);
        if (!maintenanceSlots.find(s => s.slot_id === data.slot_id)) {
            maintenanceSlots.unshift(data);
            updateMaintenanceSchedule();
        }
    });

    setInterval(async () => {
        try {
            const resp = await fetch('/api/priority-queue');
            if (resp.ok) { priorityQueue = await resp.json(); updatePriorityQueue(); }
        } catch (_) {}
    }, 2000); // Faster polling to catch escalations smoothly

    setInterval(pollLiveState, 2000);
}

async function initialLoad() {
    try {
        const [alertsResp, pqResp, maintResp, forwardingResp] = await Promise.all([
            fetch('/api/alerts'),
            fetch('/api/priority-queue'),
            fetch('/api/maintenance'),
            fetch('/api/maintenance-forwarding-status'),
        ]);
        if (alertsResp.ok) { alerts = await alertsResp.json(); alerts.forEach(a => addAlertItem(a)); }
        if (pqResp.ok) { priorityQueue = await pqResp.json(); updatePriorityQueue(); }
        if (maintResp.ok) { maintenanceSlots = await maintResp.json(); updateMaintenanceSchedule(); }
        if (forwardingResp.ok) {
            const status = await forwardingResp.json();
            updateForwardingSummary(status.forwarding);
        }
    } catch (e) { console.warn('Initial load failed, waiting for SSE:', e); }
}

document.addEventListener('DOMContentLoaded', () => {
    initMachineCards();
    MACHINE_IDS.forEach(mid => updateMachineCard(mid));
    renderAiInsights();
    initialLoad();
    connectSSE();
});
