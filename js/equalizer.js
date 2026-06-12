/**
 * 10-band Web Audio equalizer.
 *
 * Chain: source -> preamp gain -> 10x BiquadFilter (peaking, with shelves at
 * the extremes) -> analyser -> destination. Settings persist in localStorage.
 */

const FREQS = [31, 62, 125, 250, 500, 1000, 2000, 4000, 8000, 16000];

const PRESETS = {
  Flat:        [0, 0, 0, 0, 0, 0, 0, 0, 0, 0],
  'Bass Boost':[6, 5, 4, 2, 0, 0, 0, 0, 0, 0],
  'Treble Boost':[0, 0, 0, 0, 0, 0, 2, 4, 5, 6],
  Vocal:       [-2, -1, 0, 2, 4, 4, 3, 1, 0, -1],
  Electronic:  [5, 4, 1, 0, -2, 1, 0, 1, 4, 5],
  'Rock':      [4, 3, 1, 0, -1, 0, 2, 3, 3, 2],
  'Podcast':   [-4, -3, 0, 3, 4, 4, 3, 1, -2, -4],
  'Loudness':  [5, 3, 0, 0, -1, 0, 0, 1, 3, 5],
};

const STORAGE_KEY = 'airpods-hub-eq';

const els = {
  bands: document.getElementById('eq-bands'),
  presets: document.getElementById('presets'),
  preamp: document.getElementById('preamp'),
  preampVal: document.getElementById('preamp-val'),
  play: document.getElementById('btn-play'),
  test: document.getElementById('btn-test'),
  reset: document.getElementById('btn-reset'),
  drop: document.getElementById('drop-zone'),
  file: document.getElementById('file-input'),
  track: document.getElementById('track-name'),
  canvas: document.getElementById('eq-canvas'),
};

let ctx = null;
let preampNode = null;
let filters = [];
let analyser = null;
let audioEl = null;
let mediaSource = null;
let sweepNodes = null;
let playing = false;

const state = loadState();

function loadState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (saved && Array.isArray(saved.gains) && saved.gains.length === FREQS.length) {
      return saved;
    }
  } catch { /* corrupted state — fall through to defaults */ }
  return { gains: new Array(FREQS.length).fill(0), preamp: 0, preset: 'Flat' };
}

function saveState() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

/* -------------------- audio graph -------------------- */

function ensureContext() {
  if (ctx) return;
  ctx = new (window.AudioContext || window.webkitAudioContext)();

  preampNode = ctx.createGain();
  preampNode.gain.value = dbToGain(state.preamp);

  filters = FREQS.map((freq, i) => {
    const f = ctx.createBiquadFilter();
    if (i === 0) f.type = 'lowshelf';
    else if (i === FREQS.length - 1) f.type = 'highshelf';
    else { f.type = 'peaking'; f.Q.value = 1.1; }
    f.frequency.value = freq;
    f.gain.value = state.gains[i];
    return f;
  });

  analyser = ctx.createAnalyser();
  analyser.fftSize = 2048;
  analyser.smoothingTimeConstant = 0.8;

  let node = preampNode;
  for (const f of filters) { node.connect(f); node = f; }
  node.connect(analyser);
  analyser.connect(ctx.destination);
}

function dbToGain(db) { return Math.pow(10, db / 20); }

/* -------------------- sources -------------------- */

function stopSweep() {
  if (sweepNodes) {
    sweepNodes.osc.stop();
    sweepNodes = null;
  }
}

function loadFile(file) {
  ensureContext();
  stopSweep();
  if (audioEl) { audioEl.pause(); }
  audioEl = new Audio(URL.createObjectURL(file));
  audioEl.loop = true;
  // A media element can only feed one MediaElementSourceNode, so make a fresh one.
  mediaSource = ctx.createMediaElementSource(audioEl);
  mediaSource.connect(preampNode);
  els.track.textContent = `Loaded: ${file.name}`;
  els.play.disabled = false;
  setPlaying(false);
}

function startSweep() {
  ensureContext();
  ctx.resume();
  stopSweep();
  if (audioEl) audioEl.pause();

  const osc = ctx.createOscillator();
  const gain = ctx.createGain();
  osc.type = 'sine';
  gain.gain.value = 0.25;
  osc.connect(gain);
  gain.connect(preampNode);

  // Endless 20 Hz -> 16 kHz log sweep, 8 s per pass.
  const schedule = () => {
    if (!sweepNodes) return;
    const now = ctx.currentTime;
    osc.frequency.setValueAtTime(20, now);
    osc.frequency.exponentialRampToValueAtTime(16000, now + 8);
    setTimeout(schedule, 8000);
  };
  osc.start();
  sweepNodes = { osc, gain };
  schedule();
  els.track.textContent = 'Playing: test tone sweep (20 Hz → 16 kHz)';
  els.play.disabled = false;
  setPlaying(true);
}

function setPlaying(value) {
  playing = value;
  els.play.textContent = playing ? '⏸ Pause' : '▶︎ Play';
}

function togglePlay() {
  ensureContext();
  ctx.resume();
  if (sweepNodes) {
    if (playing) { sweepNodes.gain.gain.value = 0; }
    else { sweepNodes.gain.gain.value = 0.25; }
    setPlaying(!playing);
    return;
  }
  if (!audioEl) return;
  if (playing) { audioEl.pause(); setPlaying(false); }
  else { audioEl.play(); setPlaying(true); }
}

/* -------------------- UI: bands -------------------- */

function formatFreq(f) { return f >= 1000 ? `${f / 1000}k` : `${f}`; }

function buildBands() {
  FREQS.forEach((freq, i) => {
    const wrap = document.createElement('div');
    wrap.className = 'eq-band';

    const gainLabel = document.createElement('span');
    gainLabel.className = 'gain';

    const slider = document.createElement('input');
    slider.type = 'range';
    slider.min = -12; slider.max = 12; slider.step = 0.5;
    slider.value = state.gains[i];
    slider.setAttribute('aria-label', `${freq} Hz gain`);

    const freqLabel = document.createElement('span');
    freqLabel.className = 'freq';
    freqLabel.textContent = formatFreq(freq);

    const render = () => {
      const v = parseFloat(slider.value);
      gainLabel.textContent = v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`;
    };
    slider.addEventListener('input', () => {
      const v = parseFloat(slider.value);
      state.gains[i] = v;
      state.preset = null;
      if (filters[i]) filters[i].gain.setTargetAtTime(v, ctx.currentTime, 0.01);
      render();
      markActivePreset();
      saveState();
    });

    render();
    wrap.append(gainLabel, slider, freqLabel);
    els.bands.appendChild(wrap);
  });
}

function setGains(gains, presetName) {
  state.gains = [...gains];
  state.preset = presetName;
  els.bands.querySelectorAll('input[type="range"]').forEach((s, i) => {
    s.value = gains[i];
    s.dispatchEvent(new Event('render'));
    const label = s.parentElement.querySelector('.gain');
    const v = gains[i];
    label.textContent = v === 0 ? '0' : `${v > 0 ? '+' : ''}${v}`;
  });
  if (ctx) {
    filters.forEach((f, i) => f.gain.setTargetAtTime(gains[i], ctx.currentTime, 0.01));
  }
  markActivePreset();
  saveState();
}

function buildPresets() {
  Object.keys(PRESETS).forEach((name) => {
    const btn = document.createElement('button');
    btn.textContent = name;
    btn.dataset.preset = name;
    btn.addEventListener('click', () => setGains(PRESETS[name], name));
    els.presets.appendChild(btn);
  });
  markActivePreset();
}

function markActivePreset() {
  els.presets.querySelectorAll('button').forEach((b) => {
    b.classList.toggle('active', b.dataset.preset === state.preset);
  });
}

/* -------------------- visualization -------------------- */

function draw() {
  requestAnimationFrame(draw);
  const c = els.canvas;
  const g = c.getContext('2d');
  const css = getComputedStyle(document.documentElement);
  const accent = css.getPropertyValue('--accent').trim();
  const dim = css.getPropertyValue('--text-dim').trim();

  g.clearRect(0, 0, c.width, c.height);

  // Live spectrum (only when audio graph exists)
  if (analyser) {
    const data = new Uint8Array(analyser.frequencyBinCount);
    analyser.getByteFrequencyData(data);
    g.fillStyle = accent + '44';
    const barW = c.width / 128;
    for (let i = 0; i < 128; i++) {
      // Sample bins logarithmically so lows aren't squashed.
      const bin = Math.min(data.length - 1, Math.floor(Math.pow(data.length, i / 128)));
      const h = (data[bin] / 255) * c.height;
      g.fillRect(i * barW, c.height - h, barW - 1, h);
    }
  }

  // EQ curve from slider values (piecewise, drawn across log-spaced bands)
  g.strokeStyle = accent;
  g.lineWidth = 2.5;
  g.beginPath();
  const mid = c.height / 2;
  state.gains.forEach((gain, i) => {
    const x = (i / (FREQS.length - 1)) * (c.width - 20) + 10;
    const y = mid - (gain / 12) * (c.height / 2 - 10);
    if (i === 0) g.moveTo(x, y);
    else g.lineTo(x, y);
  });
  g.stroke();

  // Zero line
  g.strokeStyle = dim + '55';
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(0, mid);
  g.lineTo(c.width, mid);
  g.stroke();
}

/* -------------------- wiring -------------------- */

buildBands();
buildPresets();
draw();

els.preamp.value = state.preamp;
els.preampVal.textContent = `${state.preamp} dB`;
els.preamp.addEventListener('input', () => {
  const v = parseFloat(els.preamp.value);
  state.preamp = v;
  els.preampVal.textContent = `${v} dB`;
  if (preampNode) preampNode.gain.setTargetAtTime(dbToGain(v), ctx.currentTime, 0.01);
  saveState();
});

els.reset.addEventListener('click', () => {
  setGains(PRESETS.Flat, 'Flat');
  els.preamp.value = 0;
  state.preamp = 0;
  els.preampVal.textContent = '0 dB';
  if (preampNode) preampNode.gain.setTargetAtTime(1, ctx.currentTime, 0.01);
  saveState();
});

els.play.addEventListener('click', togglePlay);
els.test.addEventListener('click', startSweep);

els.drop.addEventListener('click', () => els.file.click());
els.file.addEventListener('change', () => {
  if (els.file.files[0]) loadFile(els.file.files[0]);
});

['dragover', 'dragenter'].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    els.drop.classList.add('over');
  })
);
['dragleave', 'drop'].forEach((ev) =>
  els.drop.addEventListener(ev, (e) => {
    e.preventDefault();
    els.drop.classList.remove('over');
  })
);
els.drop.addEventListener('drop', (e) => {
  const file = e.dataTransfer.files[0];
  if (file && file.type.startsWith('audio/')) loadFile(file);
});
