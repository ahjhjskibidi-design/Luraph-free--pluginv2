/**
 * Lua Obf — Engine entry point.
 * Exposes the main obfuscate() function.
 */

import { parse } from './parser.js';
import { PRESETS } from './presets.js';
import { transform } from './transformer.js';
import { encode } from './encoder.js';
import { flattenControlFlow } from './control-flow.js';
import { wrap } from './wrapper.js';
import { applyAntiTamper } from './anti-tamper.js';

/**
 * Main obfuscation pipeline.
 *
 * @param {string} source   Lua source code
 * @param {string} preset   One of: light | medium | heavy
 * @returns {Promise<string>}
 */
export async function obfuscate(source, preset) {
  const config = PRESETS[preset];
  if (!config) throw new Error('Unknown preset: ' + preset);

  // 1. Parse
  const ast = parse(source);

  // 2. Transform identifiers
  const renamed = transform(ast, config);

  // 3. Encode strings and numbers
  const encoded = encode(renamed, config);

  // 4. Control flow flattening
  const flattened = flattenControlFlow(encoded, config);

  // 5. Anti-tamper
  const protected_ = applyAntiTamper(flattened, config);

  // 6. Wrap in VM / multi-layer
  const output = wrap(protected_, config);

  return output;
}

export default { obfuscate };