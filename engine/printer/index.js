/**
 * Printer — main entry point.
 *
 * Usage:
 *   import { print } from './engine/printer/index.js';
 *   const source = print(ast);
 *
 * The Printer turns an AST back into Lua source. It is used by the
 * obfuscator pipeline for two things:
 *   1. Testing the parser round-trips correctly
 *   2. Producing a normalized source before encoding
 */

import { Writer } from './writer.js';
import { printBlockBody } from './statements.js';

/**
 * Print an AST to Lua source.
 */
export function print(ast) {
  const W = new Writer();

  if (!ast || ast.type !== 'Chunk') {
    throw new Error('print() expects a Chunk node, got ' + (ast && ast.type));
  }

  printBlockBody(W, ast.body);
  return W.toString();
}

export default { print };