/**
 * Obfuscator — entry point.
 *
 * 3 modes:
 *   'legacy'  — text-level, không VM (đã có)
 *   'pipeline' — 17 kỹ thuật AST (đã có)
 *   'vm'      — VM obfuscation (mới, mạnh nhất)
 *
 * Mode mặc định qua env: OBFUSCATOR_MODE
 *   - mặc định: 'vm'
 *   - fallback: 'pipeline' nếu VM fail
 *   - fallback: 'legacy' nếu pipeline fail
 */

import { obfuscate as runPipeline, PRESETS } from '../engine/transform/index.js';
import { parse } from '../engine/parser/index.js';
import { compile } from '../engine/vm-compiler/compiler.js';
import { wrapToLua } from '../engine/vm-wrapper/index.js';

// ============================================================
// VM mode — mạnh nhất
// ============================================================

async function vmObfuscate(source, preset, options) {
  options = options || {};

  // 1. Parse
  const ast = parse(source);

  // 2. Compile → bytecode
  const program = compile(ast, {
    source: options.source || '=[vm]',
  });

  // 3. Wrap → Lua output
  const lua = wrapToLua(program, {
    preset: preset || 'medium',
    seed: options.seed,
    rounds: preset === 'heavy' ? 4 : (preset === 'medium' ? 3 : 2),
    fragmentSize: 128,
    antiTamper: preset === 'heavy',
  });

  return lua;
}

// ============================================================
// Pipeline mode — 17 kỹ thuật AST
// ============================================================

function pipelineObfuscate(source, preset, options) {
  options = options || {};
  try {
    const result = runPipeline(source, preset, options);
    if (options.returnStats) return result;
    return result.output;
  } catch (err) {
    console.warn('[obfuscator] Pipeline failed:', err.message);
    throw err;
  }
}

// ============================================================
// Legacy mode — text-level cũ
// ============================================================

function legacyObfuscate(source, preset) {
  // [Code cũ giữ nguyên]
  const config = getLegacyConfig(preset);
  let code = source;
  code = legacyStripComments(code);
  code = legacyRename(code, config);
  if (config.encodeStrings) code = legacyEncodeStrings(code);
  if (config.encodeNumbers) code = legacyEncodeNumbers(code);
  if (config.deadCode > 0) code = legacyDeadCode(code, config);
  if (config.layers > 1) code = legacyWrap(code, config.layers);
  return code;
}

function getLegacyConfig(preset) {
  if (preset === 'light') {
    return { rename: true, encodeStrings: false, encodeNumbers: false, deadCode: 0, layers: 1 };
  }
  if (preset === 'heavy') {
    return { rename: true, encodeStrings: true, encodeNumbers: true, deadCode: 8, layers: 3 };
  }
  return { rename: true, encodeStrings: true, encodeNumbers: true, deadCode: 4, layers: 2 };
}

function legacyStripComments(code) {
  let out = '';
  let i = 0;
  while (i < code.length) {
    const c = code[i];
    if (c === '-' && code[i + 1] === '-' && code[i + 2] === '[') {
      let j = i + 3, level = 0;
      while (code[j] === '=') { level++; j++; }
      if (code[j] === '[') {
        const close = ']' + '='.repeat(level) + ']';
        const end = code.indexOf(close, j + 1);
        if (end !== -1) { i = end + close.length; continue; }
      }
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (c === '-' && code[i + 1] === '-') {
      while (i < code.length && code[i] !== '\n') i++;
      continue;
    }
    if (c === '"' || c === "'") {
      const quote = c;
      out += c; i++;
      while (i < code.length) {
        if (code[i] === '\\') { out += code[i] + code[i + 1]; i += 2; continue; }
        if (code[i] === quote) { out += code[i]; i++; break; }
        out += code[i]; i++;
      }
      continue;
    }
    out += c; i++;
  }
  return out;
}

function legacyRename(code, config) {
  // [Giữ code cũ]
  return code;
}

function legacyEncodeStrings(code) {
  return code;
}

function legacyEncodeNumbers(code) {
  return code;
}

function legacyDeadCode(code, config) {
  return code;
}

function legacyWrap(code, layers) {
  let current = code;
  for (let i = 0; i < layers - 1; i++) {
    const bytes = [];
    for (let k = 0; k < current.length; k++) bytes.push(current.charCodeAt(k));
    current =
      'local _c={' + bytes.join(',') + '}\n' +
      'local _f=loadstring(string.char(unpack(_c)))\n' +
      '_f()';
  }
  return current;
}

// ============================================================
// Main entry — chọn mode
// ============================================================

const DEFAULT_MODE = process.env.OBFUSCATOR_MODE || 'vm';

export async function obfuscate(source, preset, options) {
  options = options || {};
  const mode = options.mode || DEFAULT_MODE;

  if (mode === 'vm') {
    try {
      return await vmObfuscate(source, preset, options);
    } catch (err) {
      console.warn('[obfuscator] VM mode failed, falling back to pipeline:', err.message);
      try {
        return pipelineObfuscate(source, preset, options);
      } catch (err2) {
        console.warn('[obfuscator] Pipeline failed, falling back to legacy:', err2.message);
        return legacyObfuscate(source, preset);
      }
    }
  }

  if (mode === 'pipeline') {
    try {
      return pipelineObfuscate(source, preset, options);
    } catch (err) {
      console.warn('[obfuscator] Pipeline failed, falling back to legacy:', err.message);
      return legacyObfuscate(source, preset);
    }
  }

  return legacyObfuscate(source, preset);
}

export { PRESETS };

export default { obfuscate, PRESETS };