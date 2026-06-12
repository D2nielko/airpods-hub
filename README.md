# AirPods Hub

A dependency-free web app for AirPods: live battery levels (earbuds **and** charging case), a
10-band equalizer, and a page of interesting AirPods facts gathered from Apple documentation and
protocol reverse-engineering research.

## Running

No build step — it's plain HTML/CSS/JS. Serve the folder over HTTP(S) (Web Bluetooth refuses to run
from `file://`):

```sh
python3 -m http.server 8000
# open http://localhost:8000
```

`localhost` counts as a secure context; for any other host you need HTTPS.

## Platform support

| Platform | Browser | Battery (BLE scan) | Battery (GATT) | Equalizer |
|---|---|---|---|---|
| Android | Chrome / Edge | ✅ (with flag) | ✅ | ✅ |
| macOS | Chrome / Edge | ✅ (with flag) | ✅ | ✅ |
| Windows | Chrome / Edge | ✅ (with flag) | ✅ | ✅ |
| Linux | Chrome / Edge | ✅ (with flag) | ✅ | ✅ |
| iOS / iPadOS | any | ❌ no Web Bluetooth | ❌ | ✅ |
| Any | Firefox / Safari | ❌ no Web Bluetooth | ❌ | ✅ |

**The flag:** BLE advertisement scanning (`navigator.bluetooth.requestLEScan`) is still an
experimental API. Enable `chrome://flags/#enable-experimental-web-platform-features` and restart
the browser. Everything else works without flags, and **Demo mode** works in every browser.

## How battery reading works

Apple has no public AirPods API, so the app uses what actually exists:

1. **macOS bridge** (most reliable on a Mac) — Chrome's experimental BLE-scanning API often
   delivers no advertisements on macOS, but macOS itself tracks AirPods battery. Run

   ```sh
   python3 bridge/macos_bridge.py
   ```

   and the battery page auto-detects it (`http://127.0.0.1:8766/battery`) and polls the OS data
   every 10 seconds — real left/right/case levels, no flags needed.
2. **Apple proximity pairing broadcasts** (primary path on Android/Windows/Linux) — AirPods continuously advertise a BLE
   manufacturer-data message (company ID `0x004C`, type `0x07`) containing model ID, left/right
   battery (4-bit, 0–10 scale, 15 = unavailable), charging flags, and case battery. The app scans
   for these and decodes them, including the left/right "flip" bit that swaps nibbles depending on
   which pod is primary. The **case battery appears automatically** whenever the case is
   broadcasting (lid open or recently active).
3. **Standard GATT Battery Service** — AirPods don't expose it to non-Apple hosts, but many other
   earbuds do, so it's offered as a secondary path.
4. **Demo mode** — simulated data for trying the UI anywhere.

Format references: [furiousMAC continuity](https://github.com/furiousMAC/continuity/blob/master/messages/proximity_pairing.md),
[LibrePods](https://github.com/kavishdevar/librepods).

## How the equalizer works

AirPods' built-in Adaptive EQ runs on the H2 chip and has no public control API — no app on any
platform can change the device-level EQ. So the equalizer shapes the audio signal instead, with the
Web Audio API: a preamp plus 10 biquad filters (low-shelf at 31 Hz, peaking through the mids,
high-shelf at 16 kHz), applied in real time to any audio file you drop in (or a test sweep). Your
AirPods reproduce the shaped signal. Band gains, preamp, and the selected preset persist in
`localStorage`.

## Pages

- `index.html` — battery dashboard (left pod / right pod / case, charging indicators, event log)
- `equalizer.html` — 10-band EQ with presets, frequency-response curve and live spectrum
- `info.html` — misc AirPods facts with sources
