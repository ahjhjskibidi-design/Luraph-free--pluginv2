import express from 'express';
import cors from 'cors';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { obfuscate } from './obfuscator.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.static(path.join(__dirname, '..', 'public')));

app.get('/api/health', (req, res) => {
  res.json({ ok: true, version: '2.0.0' });
});

app.post('/api/obfuscate', async (req, res) => {
  const body = req.body || {};
  const code = body.code;
  const preset = body.preset || 'medium';
  const mode = body.mode || process.env.OBFUSCATOR_MODE || 'vm';

  if (typeof code !== 'string' || code.length === 0) {
    return res.status(400).json({ ok: false, error: 'Missing code' });
  }

  if (code.length > 500000) {
    return res.status(413).json({ ok: false, error: 'Code too large (max 500k)' });
  }

  try {
    const t0 = Date.now();
    const output = await obfuscate(code, preset, { mode });
    const elapsed = Date.now() - t0;

    res.json({
      ok: true,
      output: output,
      preset: preset,
      mode: mode,
      inputSize: code.length,
      outputSize: output.length,
      ratio: (output.length / code.length).toFixed(2) + 'x',
      elapsedMs: elapsed,
    });
  } catch (err) {
    console.error('[obfuscate] Error:', err);
    res.status(500).json({
      ok: false,
      error: err.message,
      stack: process.env.NODE_ENV !== 'production' ? err.stack : undefined,
    });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', () => {
  console.log('Server on http://0.0.0.0:' + PORT);
  console.log('Mode:', process.env.OBFUSCATOR_MODE || 'vm');
});