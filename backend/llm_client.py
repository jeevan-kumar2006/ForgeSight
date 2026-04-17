import os
import json
import httpx
from typing import Optional

OPENAI_API_KEY = os.environ.get("OPENAI_API_KEY", "")
OPENAI_BASE_URL = os.environ.get("OPENAI_BASE_URL", "https://api.openai.com/v1")


def _template_reasoning(
    machine_id: str,
    anomalies: dict,
    risk_score: float,
    status: str,
    baselines: dict,
) -> str:
    def parse_range(expected_range):
        if isinstance(expected_range, str):
            for sep in ['–', '-', 'to']:
                if sep in expected_range:
                    parts = expected_range.replace('to', '–').split('–') if sep == 'to' else expected_range.split(sep)
                    if len(parts) == 2:
                        try:
                            return float(parts[0]), float(parts[1])
                        except ValueError:
                            return None, None
        elif isinstance(expected_range, (list, tuple)) and len(expected_range) == 2:
            try:
                return float(expected_range[0]), float(expected_range[1])
            except ValueError:
                return None, None
        return None, None

    parts = []
    for sensor, info in anomalies.items():
        name = sensor.replace("_", " ").title()
        val = info["value"]
        dev = info["deviation_std"]
        lo, hi = parse_range(info.get("expected_range", ""))
        if info["direction"] == "above":
            if lo is not None and hi is not None:
                parts.append(f"{name} reads {val:.1f}, exceeding the upper bound of {hi:.1f} by {dev:.1f} standard deviations")
            else:
                parts.append(f"{name} reads {val:.1f}, exceeding its expected range by {dev:.1f} standard deviations")
        elif info["direction"] == "below":
            if lo is not None and hi is not None:
                parts.append(f"{name} reads {val:.1f}, falling below the lower bound of {lo:.1f} by {dev:.1f} standard deviations")
            else:
                parts.append(f"{name} reads {val:.1f}, falling outside its expected range by {dev:.1f} standard deviations")
        else:
            parts.append(f"{name} shows a gradual drift, with the running average {dev:.1f}\u03c3 from the historical mean of {info.get('baseline_mean', 0):.1f}")

    anomaly_desc = "; ".join(parts)
    n = len(anomalies)

    if risk_score > 75:
        severity = "CRITICAL \u2014 immediate intervention required"
        action = "Shut down the machine and dispatch the maintenance team now"
    elif risk_score > 50:
        severity = "HIGH \u2014 urgent attention needed"
        action = "Reduce operating load and schedule maintenance within the current shift"
    elif risk_score > 25:
        severity = "MODERATE \u2014 monitor closely"
        action = "Increase monitoring frequency and prepare a maintenance work order"
    else:
        severity = "LOW \u2014 minor deviation detected"
        action = "Continue standard monitoring; no immediate action required"

    compound = ""
    if n > 1:
        compound = f" Anomalies across {n} sensors simultaneously suggest a possible systemic issue, not an isolated sensor fault."
    status_note = ""
    if status != "running":
        status_note = f" The machine\u2019s self-reported status is \u2018{status}\u2019, which corroborates the sensor-level findings."

    return f"{severity}. {anomaly_desc}.{compound}{status_note} Recommended action: {action}."


async def generate_reasoning(
    machine_id: str,
    anomalies: dict,
    risk_score: float,
    status: str,
    baselines: dict,
) -> tuple[str, bool]:
    """Returns (reasoning_text, is_llm_generated)"""
    if not OPENAI_API_KEY:
        return _template_reasoning(machine_id, anomalies, risk_score, status, baselines), False

    sensor_details = []
    for s, info in anomalies.items():
        expected_range = info.get('expected_range', '')
        if isinstance(expected_range, str) and '–' in expected_range:
            lo_str, hi_str = expected_range.split('–')
            lo = float(lo_str)
            hi = float(hi_str)
        elif isinstance(expected_range, (list, tuple)) and len(expected_range) == 2:
            lo, hi = expected_range
        else:
            lo, hi = None, None

        range_text = expected_range if expected_range else 'unknown range'
        sensor_details.append(
            f"- {s.replace('_', ' ').title()}: current={info['value']:.2f}, "
            f"baseline range={range_text}, "
            f"deviation={info['deviation_std']:.1f}\u03c3, type={info['direction']}"
        )
    sensor_details = "\n".join(sensor_details)

    prompt = (
        "You are an industrial predictive maintenance AI analyst. "
        "Explain the following sensor anomaly in 2-3 concise sentences suitable for a maintenance technician.\n\n"
        f"Machine: {machine_id}\n"
        f"Machine Status: {status}\n"
        f"Risk Score: {risk_score:.1f}/100\n"
        f"Anomalous Sensors:\n{sensor_details}\n\n"
        "State the severity, what is happening, and the recommended action. Be specific with numbers."
    )

    try:
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                f"{OPENAI_BASE_URL}/chat/completions",
                headers={
                    "Authorization": f"Bearer {OPENAI_API_KEY}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": "gpt-4o-mini",
                    "messages": [{"role": "user", "content": prompt}],
                    "max_tokens": 200,
                    "temperature": 0.3,
                },
            )
            resp.raise_for_status()
            return resp.json()["choices"][0]["message"]["content"].strip(), True
    except Exception:
        return _template_reasoning(machine_id, anomalies, risk_score, status, baselines), False
