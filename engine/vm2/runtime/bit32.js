/**
 * bit32 runtime — the Lua 5.2 bit32 library.
 *
 * All bitwise operations in bit32 work on 32-bit unsigned integers.
 * Inputs are truncated to 32 bits; results are always in [0, 2^32).
 *
 * Functions:
 *   bit32.band(...)     — AND of all arguments
 *   bit32.bor(...)      — OR of all arguments
 *   bit32.bxor(...)     — XOR of all arguments
 *   bit32.bnot(x)       — bitwise NOT
 *   bit32.lshift(x, n)  — logical left shift
 *   bit32.rshift(x, n)  — logical right shift
 *   bit32.arshift(x, n) — arithmetic right shift
 *   bit32.lrotate(x, n) — left rotation
 *   bit32.rrotate(x, n) — right rotation
 *   bit32.extract(n, field [, width]) — extract bits
 *   bit32.replace(n, v, field [, width]) — replace bits
 *   bit32.btest(...)    — true if bitwise AND is nonzero
 *
 * Shift semantics: shift amounts can be negative (shift the other
 * way) and any (rotation is modulo 32).
 */

import { luaToNumber, luaTypeName } from './type.js';

const U32 = 0xffffffff;

// ============================================================
// Helpers
// ============================================================

function toU32(x) {
  const n = luaToNumber(x);
  // Convert to integer via bitwise truncation
  return (n >>> 0) >>> 0;
}

function toInt(x) {
  const n = luaToNumber(x);
  return n | 0;
}

// ============================================================
// AND / OR / XOR / NOT
// ============================================================

export function bitBand(...args) {
  if (args.length === 0) return U32 >>> 0;
  let result = toU32(args[0]);
  for (let i = 1; i < args.length; i++) {
    result = (result & toU32(args[i])) >>> 0;
  }
  return result;
}

export function bitBor(...args) {
  if (args.length === 0) return 0;
  let result = toU32(args[0]);
  for (let i = 1; i < args.length; i++) {
    result = (result | toU32(args[i])) >>> 0;
  }
  return result;
}

export function bitBxor(...args) {
  if (args.length === 0) return 0;
  let result = toU32(args[0]);
  for (let i = 1; i < args.length; i++) {
    result = (result ^ toU32(args[i])) >>> 0;
  }
  return result;
}

export function bitBnot(x) {
  return (~toU32(x)) >>> 0;
}

// ============================================================
// Shifts
// ============================================================

export function bitLshift(x, n) {
  const val = toU32(x);
  const shift = toInt(n);
  if (shift < 0) return bitRshift(val, -shift);
  if (shift >= 32) return 0;
  return ((val << shift) >>> 0) >>> 0;
}

export function bitRshift(x, n) {
  const val = toU32(x);
  const shift = toInt(n);
  if (shift < 0) return bitLshift(val, -shift);
  if (shift >= 32) return 0;
  return (val >>> shift) >>> 0;
}

export function bitArshift(x, n) {
  const val = toInt(x);
  const shift = toInt(n);
  if (shift < 0) return bitLshift(val, -shift);
  if (shift >= 32) return val < 0 ? U32 >>> 0 : 0;
  return (val >> shift) >>> 0;
}

// ============================================================
// Rotations
// ============================================================

export function bitLrotate(x, n) {
  const val = toU32(x);
  let shift = toInt(n) & 31;
  if (shift < 0) shift += 32;
  if (shift === 0) return val;
  return (((val << shift) | (val >>> (32 - shift))) >>> 0) >>> 0;
}

export function bitRrotate(x, n) {
  const val = toU32(x);
  let shift = toInt(n) & 31;
  if (shift < 0) shift += 32;
  if (shift === 0) return val;
  return (((val >>> shift) | (val << (32 - shift))) >>> 0) >>> 0;
}

// ============================================================
// Extract / replace
// ============================================================

export function bitExtract(n, field, width) {
  const val = toU32(n);
  const f = toInt(field);
  width = width === undefined ? 1 : toInt(width);

  if (f < 0) {
    throw new Error('bad argument #2 to bit32.extract (field cannot be negative)');
  }
  if (width <= 0) {
    throw new Error('bad argument #3 to bit32.extract (width must be positive)');
  }
  if (f + width > 32) {
    throw new Error('bad argument to bit32.extract (field + width out of range)');
  }

  const mask = width === 32 ? U32 : ((1 << width) - 1);
  return ((val >>> f) & mask) >>> 0;
}

export function bitReplace(n, v, field, width) {
  const val = toU32(n);
  const replacement = toU32(v);
  const f = toInt(field);
  width = width === undefined ? 1 : toInt(width);

  if (f < 0) {
    throw new Error('bad argument #3 to bit32.replace (field cannot be negative)');
  }
  if (width <= 0) {
    throw new Error('bad argument #4 to bit32.replace (width must be positive)');
  }
  if (f + width > 32) {
    throw new Error('bad argument to bit32.replace (field + width out of range)');
  }

  const mask = width === 32 ? U32 : ((1 << width) - 1);
  const cleared = (val & ~(mask << f)) >>> 0;
  const inserted = ((replacement & mask) << f) >>> 0;
  return ((cleared | inserted) >>> 0) >>> 0;
}

// ============================================================
// Test
// ============================================================

export function bitBtest(...args) {
  return bitBand(...args) !== 0;
}

// ============================================================
// Library object
// ============================================================

export function makeBit32Library() {
  return {
    band: bitBand,
    bor: bitBor,
    bxor: bitBxor,
    bnot: bitBnot,
    lshift: bitLshift,
    rshift: bitRshift,
    arshift: bitArshift,
    lrotate: bitLrotate,
    rrotate: bitRrotate,
    extract: bitExtract,
    replace: bitReplace,
    btest: bitBtest,
  };
}

export default {
  bitBand,
  bitBor,
  bitBxor,
  bitBnot,
  bitLshift,
  bitRshift,
  bitArshift,
  bitLrotate,
  bitRrotate,
  bitExtract,
  bitReplace,
  bitBtest,
  makeBit32Library,
};