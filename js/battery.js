/**
 * AirPods battery dashboard.
 *
 * Data sources, in order of preference:
 *  1. BLE advertisement scan — parses Apple's proximity pairing message
 *     (manufacturer 0x004C, type 0x07). Format documented by the furiousMAC
 *     continuity project and OpenPods. Requires Chrome with
 *     #enable-experimental-web-platform-features for requestLEScan.
 *  2. Standard GATT Battery Service (0x180F) — not exposed by AirPods to
 *     non-Apple hosts, but works for many other earbuds.
 *  3. Demo mode — simulated values.
 */

const APPLE_COMPANY_ID = 0x004c;
const PROXIMITY_PAIRING = 0x07;

// Known model IDs from the proximity pairing message (bytes 3-4, little-endian
// as seen on the wire => read as uint16 LE).
const MODELS = {
  0x2002: 'AirPods (1st gen)',
  0x200f: 'AirPods (2nd gen)',
  0x2013: 'AirPods (3rd gen)',
  0x2019: 'AirPods 4',
  0x201b: 'AirPods 4 (ANC)',
  0x200e: 'AirPods Pro',
  0x2014: 'AirPods Pro 2 (Lightning)',
  0x2024: 'AirPods Pro 2 (USB-C)',
  0x200a: 'AirPods Max',
  0x201f: 'AirPods Max (USB-C)',
};

const els = {
  status: document.getElementById('status'),
  statusText: document.getElementById('status-text'),
  meta: document.getElementById('device-meta'),
  log: document.getElementById('log'),
  notice: document.getElementById('compat-notice'),
  scan: document.getElementById('btn-scan'),
  gatt: document.getElementById('btn-gatt'),
  demo: document.getElementById('btn-demo'),
  bridge: document.getElementById('btn-bridge'),
  tiles: {
    left: document.getElementById('tile-left'),
    right: document.getElementById('tile-right'),
    case: document.getElementById('tile-case'),
  },
};

let demoTimer = null;
let activeScan = null;
let bridgeTimer = null;

const BRIDGE_URL = 'http://127.0.0.1:8766/battery';

function log(msg) {
  const time = new Date().toLocaleTimeString();
  els.log.textContent = `[${time}] ${msg}\n` + els.log.textContent;
}

function setStatus(text, live) {
  els.statusText.textContent = text;
  els.status.classList.toggle('live', !!live);
}

function barColor(pct) {
  if (pct <= 20) return 'var(--red)';
  if (pct <= 40) return 'var(--yellow)';
  return 'var(--green)';
}

/**
 * Update one battery tile. pct === null means "unknown / not connected".
 */
function setTile(which, pct, charging) {
  const tile = els.tiles[which];
  const pctEl = tile.querySelector('.pct');
  const fill = tile.querySelector('.fill');

  if (pct === null || pct === undefined) {
    tile.classList.remove('available', 'charging');
    pctEl.textContent = '—';
    fill.style.width = '0%';
    return;
  }
  tile.classList.add('available');
  tile.classList.toggle('charging', !!charging);
  pctEl.textContent = `${pct}%`;
  fill.style.width = `${pct}%`;
  fill.style.background = barColor(pct);
}

/**
 * Parse Apple's proximity pairing message from manufacturer data.
 *
 * Layout (offsets within the 0x004C manufacturer payload):
 *   0     type (0x07)
 *   1     length
 *   2     prefix (0x01)
 *   3-4   device model (uint16)
 *   5     status (bit 0x20: primary pod is left/right "flipped")
 *   6     pod batteries — high nibble & low nibble, 0-10 scale, 15 = unknown
 *   7     high nibble: charging flags (bit0/bit1 pods, bit2 case)
 *         low nibble: case battery, 0-10 scale, 15 = unknown
 *   8     lid open counter
 *   9     device color
 *
 * Which nibble is left vs right depends on the "flip" bit in the status byte
 * (the pods swap roles depending on which one is primary).
 */
function parseProximityPairing(dataView) {
  if (dataView.byteLength < 10) return null;
  if (dataView.getUint8(0) !== PROXIMITY_PAIRING) return null;

  const model = dataView.getUint16(3, true);
  const status = dataView.getUint8(5);
  const pods = dataView.getUint8(6);
  const chargeAndCase = dataView.getUint8(7);
  const lidCount = dataView.getUint8(8);

  const flipped = (status & 0x02) === 0;
  const nibbleHigh = (pods >> 4) & 0x0f;
  const nibbleLow = pods & 0x0f;
  const toPct = (n) => (n === 15 ? null : Math.min(n * 10, 100));

  const left = toPct(flipped ? nibbleHigh : nibbleLow);
  const right = toPct(flipped ? nibbleLow : nibbleHigh);
  const casePct = toPct(chargeAndCase & 0x0f);

  const chargeFlags = (chargeAndCase >> 4) & 0x0f;
  const leftCharging = !!(chargeFlags & (flipped ? 0b10 : 0b01));
  const rightCharging = !!(chargeFlags & (flipped ? 0b01 : 0b10));
  const caseCharging = !!(chargeFlags & 0b100);

  return {
    model: MODELS[model] || `Unknown Apple audio device (0x${model.toString(16)})`,
    left, right, casePct,
    leftCharging, rightCharging, caseCharging,
    lidCount,
  };
}

function applyReading(r, source) {
  setTile('left', r.left, r.leftCharging);
  setTile('right', r.right, r.rightCharging);
  setTile('case', r.casePct, r.caseCharging);
  els.meta.textContent = `${r.model} · via ${source}` +
    (r.casePct === null ? ' · case not broadcasting (open the lid)' : '');
  setStatus('Receiving data', true);
}

/* -------------------- 1. BLE advertisement scan -------------------- */

async function startScan() {
  stopDemo();
  if (!navigator.bluetooth || !navigator.bluetooth.requestLEScan) {
    log('requestLEScan unavailable. Enable chrome://flags/#enable-experimental-web-platform-features and reload.');
    showNotice(
      'BLE scanning needs Chrome/Edge with the <strong>experimental web platform features</strong> flag enabled ' +
      '(<code>chrome://flags/#enable-experimental-web-platform-features</code>). ' +
      'Until then, try “Connect via GATT” or “Demo mode”.'
    );
    return;
  }
  try {
    log('Requesting BLE scan permission…');
    activeScan = await navigator.bluetooth.requestLEScan({
      acceptAllAdvertisements: true,
      keepRepeatedDevices: true,
    });
    setStatus('Scanning…', true);
    log('Scan started. Listening for Apple proximity pairing broadcasts…');

    navigator.bluetooth.addEventListener('advertisementreceived', (event) => {
      const apple = event.manufacturerData.get(APPLE_COMPANY_ID);
      if (!apple) return;
      const reading = parseProximityPairing(apple);
      if (!reading) return;
      applyReading(reading, `BLE broadcast (RSSI ${event.rssi} dBm)`);
    });
  } catch (err) {
    log(`Scan failed: ${err.message}`);
    setStatus('Scan failed', false);
  }
}

/* -------------------- 2. GATT battery service -------------------- */

async function connectGatt() {
  stopDemo();
  if (!navigator.bluetooth) {
    showNotice(
      'Web Bluetooth isn’t available in this browser. Use Chrome or Edge on Android, macOS, Windows, ' +
      'or Linux. (iOS Safari does not support Web Bluetooth at all.)'
    );
    return;
  }
  try {
    log('Opening device chooser…');
    const device = await navigator.bluetooth.requestDevice({
      acceptAllDevices: true,
      optionalServices: ['battery_service'],
    });
    log(`Selected "${device.name || 'unnamed device'}". Connecting…`);
    setStatus('Connecting…', false);

    const server = await device.gatt.connect();
    const service = await server.getPrimaryService('battery_service');
    const characteristic = await service.getCharacteristic('battery_level');

    const update = async () => {
      const value = await characteristic.readValue();
      const pct = value.getUint8(0);
      // The standard service reports a single level — show it on both pods.
      setTile('left', pct, false);
      setTile('right', pct, false);
      setTile('case', null, false);
      els.meta.textContent = `${device.name || 'Bluetooth device'} · via GATT Battery Service`;
      setStatus('Connected (GATT)', true);
      log(`Battery level: ${pct}%`);
    };

    await update();
    try {
      await characteristic.startNotifications();
      characteristic.addEventListener('characteristicvaluechanged', (e) => {
        const pct = e.target.value.getUint8(0);
        setTile('left', pct, false);
        setTile('right', pct, false);
        log(`Battery update: ${pct}%`);
      });
    } catch {
      // Notifications optional; fall back to one-shot read.
    }

    device.addEventListener('gattserverdisconnected', () => {
      setStatus('Disconnected', false);
      log('Device disconnected.');
    });
  } catch (err) {
    log(`GATT connect failed: ${err.message}`);
    if (/battery_service/.test(err.message) || err.name === 'NotFoundError') {
      log('Note: AirPods do not expose the standard battery service to non-Apple hosts. Use the BLE scan instead.');
    }
    setStatus('Not connected', false);
  }
}

/* -------------------- 3. macOS bridge -------------------- */

async function pollBridge() {
  const res = await fetch(BRIDGE_URL, { signal: AbortSignal.timeout(3000) });
  if (!res.ok) throw new Error(`bridge returned ${res.status}`);
  const { devices } = await res.json();
  // Prefer a device with per-pod levels (AirPods); fall back to any battery.
  const pods = devices.find((d) => d.left !== null || d.right !== null);
  const dev = pods || devices.find((d) => d.single !== null);
  if (!dev) {
    setStatus('Bridge: no battery devices', false);
    return;
  }
  applyReading({
    model: dev.name + (dev.connected ? '' : ' (last known)'),
    left: dev.left ?? dev.single,
    right: dev.right ?? dev.single,
    casePct: dev.case,
    leftCharging: false, rightCharging: false, caseCharging: false,
  }, 'macOS Bluetooth daemon');
}

async function startBridge(manual) {
  stopDemo();
  if (bridgeTimer) clearInterval(bridgeTimer);
  try {
    await pollBridge();
    log('Connected to macOS bridge — polling every 10 s.');
    bridgeTimer = setInterval(() => pollBridge().catch((e) => log(`Bridge poll failed: ${e.message}`)), 10000);
  } catch (err) {
    if (manual) {
      log(`Bridge not reachable at ${BRIDGE_URL}.`);
      showNotice(
        'The macOS bridge isn’t running. Start it in a terminal with ' +
        '<code>python3 bridge/macos_bridge.py</code> (from the airpods-webapp folder), then click ' +
        '“macOS bridge” again.'
      );
    }
    throw err;
  }
}

/* -------------------- 4. Demo mode -------------------- */

function stopDemo() {
  if (demoTimer) {
    clearInterval(demoTimer);
    demoTimer = null;
  }
}

function startDemo() {
  stopDemo();
  let left = 80, right = 75, casePct = 60;
  const tick = () => {
    left = Math.max(5, left - Math.random() * 1.5);
    right = Math.max(5, right - Math.random() * 1.5);
    casePct = Math.min(100, casePct + Math.random() * 0.5);
    applyReading({
      model: 'AirPods Pro 2 (demo)',
      left: Math.round(left), right: Math.round(right), casePct: Math.round(casePct),
      leftCharging: false, rightCharging: false, caseCharging: true,
    }, 'demo simulation');
  };
  tick();
  demoTimer = setInterval(tick, 2500);
  log('Demo mode started — values are simulated.');
}

/* -------------------- wiring -------------------- */

function showNotice(html) {
  els.notice.innerHTML = html;
  els.notice.hidden = false;
}

els.scan.addEventListener('click', startScan);
els.gatt.addEventListener('click', connectGatt);
els.demo.addEventListener('click', startDemo);
els.bridge.addEventListener('click', () => startBridge(true).catch(() => {}));

// Auto-detect the macOS bridge on load — silently ignore if it's not running.
startBridge(false).catch(() => {});

if (!navigator.bluetooth) {
  showNotice(
    'This browser has no Web Bluetooth support — battery features need <strong>Chrome or Edge</strong> on ' +
    'Android, macOS, Windows, or Linux. Demo mode still works everywhere.'
  );
  els.scan.disabled = true;
  els.gatt.disabled = true;
  log('Web Bluetooth unavailable in this browser.');
} else {
  log('Web Bluetooth available.');
  if (!navigator.bluetooth.requestLEScan) {
    log('Tip: BLE scanning (best for AirPods) needs chrome://flags/#enable-experimental-web-platform-features.');
  }
}
