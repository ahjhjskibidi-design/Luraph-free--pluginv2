/**
 * Lua Obf — API router.
 * Endpoints:
 *   GET  /api/health       — health check
 *   POST /api/obfuscate    — obfuscate a Lua script
 *   GET  /api/presets      — list available presets
 */

import express from 'express';
import { obfuscate } from '../engine/index.js';
import { PRESETS } from '../engine/presets.js';

const router = express.Router();

// --- Health check ---

router.get('/health', (req, res) => {
  res.json({
    ok: true,
    version: '1.0.0',
    time: new Date().toISOString(),
  });
});

// --- Presets ---

router.get('/presets', (req, res) => {
  res.json({
    ok: true,
    presets: Object.keys(PRESETS).map(function (key) {
      return {
        id: key,
        label: PRESETS[key].label,
        description: PRESETS[key].description,
      };
    }),
  });
});

// --- Obfuscate ---

router.post('/obfuscate', async (req, res, next) => {
  try {
    const { code, preset } = req.body || {};

    // Validate
    if (typeof code !== 'string') {
      return res.status(400).json({
        ok: false,
        error: 'Missing "code" field (must be a string)',
      });
    }

    if (code.length === 0) {
      return res.status(400).json({
        ok: false,
        error: 'Code is empty',
      });
    }

    if (code.length > 500000) {
      return res.status(413).json({
        ok: false,
        error: 'Code too large (max 500,000 chars)',
      });
    }

    const presetName = typeof preset === 'string' ? preset : 'medium';

    if (!PRESETS[presetName]) {
      return res.status(400).json({
        ok: false,
        error: 'Unknown preset: ' + presetName,
      });
    }

    const t0 = Date.now();
    const output = await obfuscate(code, presetName);
    const elapsed = Date.now() - t0;

    res.json({
      ok: true,
      output: output,
      preset: presetName,
      inputSize: code.length,
      outputSize: output.length,
      elapsedMs: elapsed,
    });
  } catch (err) {
    next(err);
  }
});

export default router;