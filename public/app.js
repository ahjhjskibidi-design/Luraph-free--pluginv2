/**
 * Lua Obf — Frontend
 * Talks to the backend /api/obfuscate endpoint.
 */

(function () {
  'use strict';

  // --- State ---

  var state = {
    preset: 'medium',
    busy: false,
    lastOutput: '',
  };

  // --- Refs ---

  var input = document.getElementById('input');
  var output = document.getElementById('output');
  var inputStats = document.getElementById('input-stats');
  var outputStats = document.getElementById('output-stats');
  var btnObfuscate = document.getElementById('btn-obfuscate');
  var btnCopy = document.getElementById('btn-copy');
  var btnDownload = document.getElementById('btn-download');
  var btnClear = document.getElementById('btn-clear');
  var metaPreset = document.getElementById('meta-preset');
  var metaInput = document.getElementById('meta-input');
  var metaOutput = document.getElementById('meta-output');
  var metaRatio = document.getElementById('meta-ratio');
  var metaTime = document.getElementById('meta-time');
  var status = document.getElementById('status');
  var presetButtons = document.querySelectorAll('.preset');

  // --- Helpers ---

  function setStatus(text, kind) {
    status.textContent = text;
    status.className = 'status' + (kind ? ' ' + kind : '');
  }

  function humanSize(bytes) {
    if (bytes < 1024) return bytes + ' B';
    if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
    return (bytes / 1024 / 1024).toFixed(2) + ' MB';
  }

  function updateInputStats() {
    var n = input.value.length;
    inputStats.textContent = n + ' chars';
  }

  function updateOutputStats() {
    if (!state.lastOutput) {
      outputStats.textContent = '—';
      return;
    }
    outputStats.textContent = state.lastOutput.length + ' chars';
  }

  function updateMeta(inputSize, outputSize, elapsedMs) {
    metaPreset.textContent = state.preset.charAt(0).toUpperCase() + state.preset.slice(1);
    metaInput.textContent = inputSize ? humanSize(inputSize) : '—';
    metaOutput.textContent = outputSize ? humanSize(outputSize) : '—';
    if (inputSize && outputSize) {
      var ratio = outputSize / inputSize;
      metaRatio.textContent = ratio.toFixed(2) + 'x';
    } else {
      metaRatio.textContent = '—';
    }
    metaTime.textContent = elapsedMs != null ? elapsedMs + ' ms' : '—';
  }

  function setBusy(busy) {
    state.busy = busy;
    btnObfuscate.disabled = busy;
    btnObfuscate.textContent = busy ? 'Working...' : 'Obfuscate';
    input.disabled = busy;
    presetButtons.forEach(function (b) { b.disabled = busy; });
  }

  // --- Preset selection ---

  presetButtons.forEach(function (b) {
    b.addEventListener('click', function () {
      if (state.busy) return;
      state.preset = b.getAttribute('data-preset');
      presetButtons.forEach(function (x) {
        x.classList.toggle('active', x === b);
      });
      metaPreset.textContent = state.preset.charAt(0).toUpperCase() + state.preset.slice(1);
    });
  });

  // --- Obfuscate ---

  async function obfuscate() {
    var code = input.value;
    if (!code.trim()) {
      setStatus('Nothing to obfuscate', 'warn');
      return;
    }

    setBusy(true);
    setStatus('Obfuscating...', 'warn');
    var t0 = performance.now();

    try {
      var res = await fetch('/api/obfuscate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          code: code,
          preset: state.preset,
        }),
      });

      var data = await res.json();

      if (!res.ok || !data.ok) {
        throw new Error(data.error || ('HTTP ' + res.status));
      }

      var elapsed = Math.round(performance.now() - t0);
      state.lastOutput = data.output;
      output.value = data.output;
      updateOutputStats();
      updateMeta(code.length, data.output.length, elapsed);
      btnCopy.disabled = false;
      btnDownload.disabled = false;
      setStatus('Done in ' + elapsed + ' ms', 'ok');
    } catch (err) {
      console.error(err);
      output.value = '';
      state.lastOutput = '';
      btnCopy.disabled = true;
      btnDownload.disabled = true;
      setStatus('Error: ' + err.message, 'error');
    } finally {
      setBusy(false);
    }
  }

  // --- Copy ---

  async function copyOutput() {
    if (!state.lastOutput) return;
    try {
      await navigator.clipboard.writeText(state.lastOutput);
      setStatus('Copied to clipboard', 'ok');
    } catch (err) {
      output.select();
      document.execCommand('copy');
      setStatus('Copied (fallback)', 'ok');
    }
  }

  // --- Download ---

  function downloadOutput() {
    if (!state.lastOutput) return;
    var blob = new Blob([state.lastOutput], { type: 'text/plain;charset=utf-8' });
    var url = URL.createObjectURL(blob);
    var a = document.createElement('a');
    a.href = url;
    a.download = 'obfuscated-' + Date.now() + '.lua';
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(function () { URL.revokeObjectURL(url); }, 5000);
    setStatus('Downloaded', 'ok');
  }

  // --- Clear ---

  function clearAll() {
    input.value = '';
    output.value = '';
    state.lastOutput = '';
    updateInputStats();
    updateOutputStats();
    updateMeta(0, 0, null);
    btnCopy.disabled = true;
    btnDownload.disabled = true;
    setStatus('Ready', '');
  }

  // --- Wire ---

  input.addEventListener('input', updateInputStats);
  btnObfuscate.addEventListener('click', obfuscate);
  btnCopy.addEventListener('click', copyOutput);
  btnDownload.addEventListener('click', downloadOutput);
  btnClear.addEventListener('click', clearAll);

  // Keyboard: Cmd/Ctrl+Enter to obfuscate
  input.addEventListener('keydown', function (e) {
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      obfuscate();
    }
  });

  // Init
  updateInputStats();
  updateMeta(0, 0, null);

  // Health check
  fetch('/api/health')
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (d && d.ok) setStatus('Ready (v' + d.version + ')', '');
    })
    .catch(function () {
      setStatus('Backend offline', 'error');
    });
})();