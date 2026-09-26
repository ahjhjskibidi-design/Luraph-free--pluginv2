/**
 * Anti-tamper — main entry point.
 *
 * Usage:
 *   import { applyAntiTamper } from './engine/anti-tamper/index.js';
 *   const newAst = applyAntiTamper(ast, { level: 'medium' });
 *
 * Prepends a set of guard statements to the top of the chunk. The
 * guards check the runtime environment and exit early on anomalies.
 *
 * Level options:
 *   'light'  — only loadstring and type guards
 *   'medium' — plus debug and environment shape (default)
 *   'heavy'  — all guards including timing
 */

import { NODE } from '../parser/types.js';
import * as G from './guards.js';
import { timingGuard } from './timing.js';
import * as I from './integrity.js';

export function applyAntiTamper(ast, options) {
  if (!ast || ast.type !== NODE.CHUNK) return ast;

  const level = (options && options.level) || 'medium';
  const guards = [];

  if (level === 'light') {
    guards.push(G.loadstringGuard());
    guards.push(G.typeGuard());
  } else if (level === 'medium') {
    guards.push(G.loadstringGuard());
    guards.push(G.typeGuard());
    guards.push(G.debugPresentGuard());
    guards.push(I.environmentShapeGuard());
  } else {
    // heavy
    guards.push(G.loadstringGuard());
    guards.push(G.typeGuard());
    guards.push(G.debugPresentGuard());
    guards.push(G.debugGetinfoGuard());
    guards.push(G.noDebugHookGuard());
    guards.push(G.getfenvGuard());
    guards.push(I.environmentShapeGuard());
    guards.push(I.stringLibraryGuard());
    guards.push(timingGuard());
  }

  // Wrap all guards in a single outer block, then prepend to the chunk.
  // Using an outer block gives them their own scope and avoids
  // polluting the main chunk's locals.
  const guardBlock = {
    type: NODE.DO,
    body: { type: NODE.BLOCK, body: guards },
  };

  ast.body.body = [guardBlock, ...ast.body.body];
  return ast;
}

export default { applyAntiTamper };