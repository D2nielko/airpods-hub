#!/usr/bin/env python3
"""
macOS battery bridge for AirPods Hub.

Chrome's experimental BLE-scanning API often delivers no advertisements on
macOS, but macOS itself tracks AirPods battery via its Bluetooth daemon. This
bridge exposes that data to the web app:

    GET http://127.0.0.1:8766/battery

Stdlib only. Run with:  python3 bridge/macos_bridge.py
"""
import json
import re
import subprocess
import time
from http.server import BaseHTTPRequestHandler, HTTPServer

PORT = 8766
CACHE_SECONDS = 5

_cache = {"at": 0.0, "data": None}


def read_bluetooth_devices():
    out = subprocess.run(
        ["system_profiler", "SPBluetoothDataType", "-json"],
        capture_output=True, text=True, timeout=15,
    ).stdout
    root = json.loads(out)["SPBluetoothDataType"][0]

    pct = lambda s: int(re.sub(r"\D", "", s)) if s else None
    devices = []
    for section, connected in (("device_connected", True),
                               ("device_not_connected", False)):
        for entry in root.get(section) or []:
            for name, info in entry.items():
                levels = {k: v for k, v in info.items()
                          if k.startswith("device_batteryLevel")}
                if not levels:
                    continue
                devices.append({
                    "name": name,
                    "connected": connected,
                    "left": pct(levels.get("device_batteryLevelLeft")),
                    "right": pct(levels.get("device_batteryLevelRight")),
                    "case": pct(levels.get("device_batteryLevelCase")),
                    "single": pct(levels.get("device_batteryLevel")),
                    "minorType": info.get("device_minorType"),
                    "firmware": info.get("device_firmwareVersion"),
                })
    return devices


class Handler(BaseHTTPRequestHandler):
    def _send(self, code, payload):
        body = json.dumps(payload).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path != "/battery":
            self._send(404, {"error": "use /battery"})
            return
        now = time.time()
        if now - _cache["at"] > CACHE_SECONDS:
            try:
                _cache["data"] = read_bluetooth_devices()
                _cache["at"] = now
            except Exception as exc:  # surface errors to the web app
                self._send(500, {"error": str(exc)})
                return
        self._send(200, {"devices": _cache["data"], "source": "macOS Bluetooth daemon"})

    def log_message(self, *args):
        pass  # keep the terminal quiet


if __name__ == "__main__":
    print(f"AirPods Hub macOS bridge → http://127.0.0.1:{PORT}/battery  (Ctrl-C to stop)")
    HTTPServer(("127.0.0.1", PORT), Handler).serve_forever()
