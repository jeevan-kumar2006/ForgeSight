import argparse
import base64
import os
from typing import Dict, List, Optional

import httpx

try:
    import serial  # type: ignore
except Exception:  # pragma: no cover
    serial = None


def _env_bool(name: str, default: bool = False) -> bool:
    value = os.getenv(name)
    if value is None:
        return default
    return value.strip().lower() in {"1", "true", "yes", "on"}


def _env_list(name: str) -> List[str]:
    raw = os.getenv(name, "")
    return [x.strip() for x in raw.split(",") if x.strip()]


class SmsAlerter:
    """Dispatches high/critical alerts via modem, webhook, or Twilio."""

    def __init__(self) -> None:
        self.provider = os.getenv("SMS_PROVIDER", "auto").strip().lower()

        # Modem mode
        self.modem_enabled = _env_bool("SMS_ENABLED", False)
        self.modem_port = os.getenv("SMS_MODEM_PORT", "")
        self.modem_baudrate = int(os.getenv("SMS_BAUDRATE", "115200"))

        # Common recipients
        self.recipients = _env_list("SMS_RECIPIENTS")

        # Webhook mode
        self.webhook_enabled = _env_bool("WEBHOOK_ENABLED", False)
        self.webhook_url = os.getenv("ALERT_WEBHOOK_URL", "")
        self.webhook_bearer = os.getenv("ALERT_WEBHOOK_BEARER", "")
        self.webhook_timeout = float(os.getenv("ALERT_WEBHOOK_TIMEOUT_SEC", "8"))

        # Twilio mode
        self.twilio_enabled = _env_bool("TWILIO_ENABLED", False)
        self.twilio_sid = os.getenv("TWILIO_ACCOUNT_SID", "")
        self.twilio_token = os.getenv("TWILIO_AUTH_TOKEN", "")
        self.twilio_from = os.getenv("TWILIO_FROM_NUMBER", "")

    def send_alert(self, alert: Dict) -> bool:
        priority = str(alert.get("priority", "")).lower()
        if priority not in {"high", "critical"}:
            return False

        if not self.recipients:
            print("[SMS] No SMS_RECIPIENTS configured; skipping alert dispatch")
            return False

        message = self._format_message(alert)
        provider = self.provider

        if provider == "modem":
            return self._send_modem(message)
        if provider == "webhook":
            return self._send_webhook(alert, message)
        if provider == "twilio":
            return self._send_twilio(message)

        # auto mode: modem -> webhook -> twilio
        if self._send_modem(message):
            return True
        if self._send_webhook(alert, message):
            return True
        if self._send_twilio(message):
            return True
        return False

    def _format_message(self, alert: Dict) -> str:
        machine = alert.get("machine_id", "UNKNOWN")
        prio = str(alert.get("priority", "")).upper() or "ALERT"
        risk = alert.get("risk_score", "-")
        reason = alert.get("reason_summary", "No summary")
        return f"ForgeSight {prio}: {machine} | risk={risk} | {reason}"

    def _send_modem(self, message: str) -> bool:
        if not self.modem_enabled:
            return False
        if serial is None:
            print("[SMS] pyserial unavailable; cannot send via modem")
            return False
        if not self.modem_port:
            print("[SMS] SMS_MODEM_PORT not set; cannot send via modem")
            return False

        try:
            with serial.Serial(self.modem_port, self.modem_baudrate, timeout=5) as modem:
                modem.write(b"AT\r")
                modem.readline()
                modem.write(b"AT+CMGF=1\r")
                modem.readline()
                for number in self.recipients:
                    modem.write(f'AT+CMGS="{number}"\r'.encode())
                    modem.readline()
                    modem.write(message.encode("utf-8") + b"\x1a")
                    modem.readline()
            print("[SMS] Alert sent via modem")
            return True
        except Exception as exc:
            print(f"[SMS] Modem send failed: {exc}")
            return False

    def _send_webhook(self, alert: Dict, message: str) -> bool:
        if not self.webhook_enabled:
            return False
        if not self.webhook_url:
            print("[SMS] ALERT_WEBHOOK_URL not set; cannot send webhook")
            return False

        payload = {
            "message": message,
            "alert": alert,
            "recipients": self.recipients,
        }
        headers = {"Content-Type": "application/json"}
        if self.webhook_bearer:
            headers["Authorization"] = f"Bearer {self.webhook_bearer}"

        try:
            resp = httpx.post(self.webhook_url, json=payload, headers=headers, timeout=self.webhook_timeout)
            resp.raise_for_status()
            print("[SMS] Alert sent via webhook")
            return True
        except Exception as exc:
            print(f"[SMS] Webhook send failed: {exc}")
            return False

    def _send_twilio(self, message: str) -> bool:
        if not self.twilio_enabled:
            return False
        if not (self.twilio_sid and self.twilio_token and self.twilio_from):
            print("[SMS] Twilio credentials incomplete; cannot send via Twilio")
            return False

        url = f"https://api.twilio.com/2010-04-01/Accounts/{self.twilio_sid}/Messages.json"
        auth_raw = f"{self.twilio_sid}:{self.twilio_token}".encode("utf-8")
        auth = base64.b64encode(auth_raw).decode("ascii")
        headers = {"Authorization": f"Basic {auth}"}

        ok = False
        for number in self.recipients:
            data = {"From": self.twilio_from, "To": number, "Body": message}
            try:
                resp = httpx.post(url, data=data, headers=headers, timeout=10.0)
                resp.raise_for_status()
                ok = True
            except Exception as exc:
                print(f"[SMS] Twilio send failed for {number}: {exc}")
        if ok:
            print("[SMS] Alert sent via Twilio")
        return ok


def _build_test_alert(args: argparse.Namespace) -> Dict:
    return {
        "alert_id": "manualtest",
        "machine_id": args.machine,
        "priority": args.priority,
        "risk_score": args.risk,
        "reason_summary": args.reason,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Send a manual ForgeSight SMS/webhook/Twilio test alert")
    parser.add_argument("--provider", choices=["auto", "modem", "webhook", "twilio"], default="auto")
    parser.add_argument("--machine", default="CNC_01")
    parser.add_argument("--priority", choices=["low", "medium", "high", "critical"], default="high")
    parser.add_argument("--risk", type=float, default=78.0)
    parser.add_argument("--reason", default="Manual alert test")
    args = parser.parse_args()

    if "SMS_PROVIDER" not in os.environ:
        os.environ["SMS_PROVIDER"] = args.provider

    alerter = SmsAlerter()
    success = alerter.send_alert(_build_test_alert(args))
    raise SystemExit(0 if success else 1)


if __name__ == "__main__":
    main()
