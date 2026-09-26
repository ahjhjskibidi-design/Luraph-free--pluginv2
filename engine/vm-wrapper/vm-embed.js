/**
 * VM Embed — nhúng VM Lua vào output dưới dạng string.
 *
 * File vm.lua được đọc, một số identifier đổi tên để mỗi build
 * khác nhau (chống static analysis).
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const VM_LUA_PATH = path.join(__dirname, '..', 'vm-lua', 'vm.lua');

let cachedVM = null;

/**
 * Đọc file vm.lua và cache lại.
 */
function loadVMSource() {
  if (cachedVM !== null) return cachedVM;
  try {
    cachedVM = fs.readFileSync(VM_LUA_PATH, 'utf8');
  } catch (err) {
    throw new Error('Cannot load vm.lua at ' + VM_LUA_PATH + ': ' + err.message);
  }
  return cachedVM;
}

/**
 * Đổi tên identifier trong VM Lua (đơn giản).
 * Mục đích: mỗi build có identifier khác nhau.
 */
function renameVMIdentifiers(source, seed) {
  const suffixes = ['_a', '_b', '_c', '_d', '_e'];
  const suffix = suffixes[seed % suffixes.length];

  // Đổi tên `VM` → `VM<suffix>` và một số tên khác
  let out = source;
  out = out.replace(/\bVM\b/g, 'VM' + suffix);
  return out;
}

/**
 * Wrapper để load VM trong output.
 */
function wrapVMEntry(vmSource, seed) {
  const suffix = ['_a', '_b', '_c', '_d', '_e'][seed % 5];
  const vmName = 'VM' + suffix;

  // Đổi tên trong source
  const renamed = vmSource.replace(/\bVM\b/g, vmName);

  return {
    source: renamed,
    vmEntry: vmName + '.run',
  };
}

/**
 * Get VM Lua source đã rename cho build này.
 */
export function getVMForBuild(seed) {
  const raw = loadVMSource();
  return wrapVMEntry(raw, seed);
}

export default { getVMForBuild, loadVMSource };