/**
 * VM Wrapper — entry point.
 *
 * Nhận program từ compiler, trả về Lua source đã obfuscate.
 */

import { wrapProgram } from './wrapper.js';
import { encryptProgram } from './encryptor.js';
import { getVMForBuild } from './vm-embed.js';

/**
 * Compile AST → bytecode → encrypt → wrap → output Lua.
 */
export function wrapToLua(program, options) {
  options = options || {};
  return wrapProgram(program, options);
}

export default {
  wrapToLua,
  wrapProgram,
  encryptProgram,
  getVMForBuild,
};