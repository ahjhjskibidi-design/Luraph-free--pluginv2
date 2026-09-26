/**
 * Math runtime — full Lua math library implementation.
 *
 * Lua 5.1 math library:
 *   math.abs, math.acos, math.asin, math.atan, math.atan2
 *   math.ceil, math.cos, math.cosh, math.deg, math.exp
 *   math.floor, math.fmod, math.frexp, math.ldexp, math.log
 *   math.log10, math.max, math.min, math.modf, math.pow
 *   math.rad, math.random, math.randomseed, math.sin, math.sinh
 *   math.sqrt, math.tan, math.tanh
 *   math.pi, math.huge
 *
 * Lua 5.3 math library:
 *   math.maxinteger, math.mininteger, math.tointeger, math.type
 *   math.ult
 *
 * Roblox Luau adds:
 *   math.clamp, math.sign, math.round, math.noise
 *
 * Our implementation targets Lua 5.1 as the baseline, adds the 5.3
 * integer helpers, and includes the Luau extensions where useful.
 */

import { luaToNumber, luaTypeName } from './type.js';

// ============================================================
// Constants
// ============================================================

export const mathPi = Math.PI;
export const mathHuge = Infinity;
export const mathMaxInteger = 2147483647;
export const mathMinInteger = -2147483648;

// ============================================================
// Basic functions
// ============================================================

export function mathAbs(x) {
  return Math.abs(luaToNumber(x));
}

export function mathCeil(x) {
  return Math.ceil(luaToNumber(x));
}

export function mathFloor(x) {
  return Math.floor(luaToNumber(x));
}

export function mathSqrt(x) {
  return Math.sqrt(luaToNumber(x));
}

export function mathExp(x) {
  return Math.exp(luaToNumber(x));
}

// ============================================================
// Trigonometry
// ============================================================

export function mathSin(x) {
  return Math.sin(luaToNumber(x));
}

export function mathCos(x) {
  return Math.cos(luaToNumber(x));
}

export function mathTan(x) {
  return Math.tan(luaToNumber(x));
}

export function mathAsin(x) {
  return Math.asin(luaToNumber(x));
}

export function mathAcos(x) {
  return Math.acos(luaToNumber(x));
}

export function mathAtan(x) {
  return Math.atan(luaToNumber(x));
}

export function mathAtan2(y, x) {
  return Math.atan2(luaToNumber(y), luaToNumber(x));
}

export function mathSinh(x) {
  return Math.sinh(luaToNumber(x));
}

export function mathCosh(x) {
  return Math.cosh(luaToNumber(x));
}

export function mathTanh(x) {
  return Math.tanh(luaToNumber(x));
}

export function mathDeg(x) {
  return luaToNumber(x) * 180 / Math.PI;
}

export function mathRad(x) {
  return luaToNumber(x) * Math.PI / 180;
}

// ============================================================
// Logarithm
// ============================================================

export function mathLog(x, base) {
  const n = luaToNumber(x);
  if (base === undefined) return Math.log(n);
  return Math.log(n) / Math.log(luaToNumber(base));
}

export function mathLog10(x) {
  return Math.log10(luaToNumber(x));
}

// ============================================================
// Integer / modular
// ============================================================

export function mathFmod(x, y) {
  // Lua's fmod: result has the sign of the dividend (unlike %)
  return luaToNumber(x) % luaToNumber(y);
}

export function mathModf(x) {
  const n = luaToNumber(x);
  const intPart = n >= 0 ? Math.floor(n) : Math.ceil(n);
  const fracPart = n - intPart;
  return [intPart, fracPart];
}

// ============================================================
// Float manipulation
// ============================================================

export function mathFrexp(x) {
  const n = luaToNumber(x);
  if (n === 0) return [0, 0];
  if (!isFinite(n)) return [n, 0];
  const sign = n < 0 ? -1 : 1;
  const absN = Math.abs(n);
  const exp = Math.floor(Math.log2(absN)) + 1;
  const mantissa = sign * absN / Math.pow(2, exp);
  return [mantissa, exp];
}

export function mathLdexp(m, e) {
  return luaToNumber(m) * Math.pow(2, luaToNumber(e));
}

// ============================================================
// Min / Max
// ============================================================

export function mathMax(...args) {
  if (args.length === 0) {
    throw new Error('bad argument #1 to math.max (value expected)');
  }
  let max = luaToNumber(args[0]);
  for (let i = 1; i < args.length; i++) {
    const v = luaToNumber(args[i]);
    if (v > max) max = v;
  }
  return max;
}

export function mathMin(...args) {
  if (args.length === 0) {
    throw new Error('bad argument #1 to math.min (value expected)');
  }
  let min = luaToNumber(args[0]);
  for (let i = 1; i < args.length; i++) {
    const v = luaToNumber(args[i]);
    if (v < min) min = v;
  }
  return min;
}

// ============================================================
// Power
// ============================================================

export function mathPow(x, y) {
  return Math.pow(luaToNumber(x), luaToNumber(y));
}

// ============================================================
// Random
// ============================================================

let randomSeed = 12345;

export function mathRandomSeed(seed) {
  if (seed === undefined) {
    randomSeed = Date.now() & 0x7fffffff;
  } else {
    randomSeed = Math.trunc(luaToNumber(seed)) & 0x7fffffff;
  }
  if (randomSeed === 0) randomSeed = 1;
}

/**
 * math.random() — float in [0, 1)
 * math.random(m) — integer in [1, m]
 * math.random(m, n) — integer in [m, n]
 *
 * Uses xorshift32 for determinism. Good enough for script use, not
 * cryptographic.
 */
export function mathRandom(...args) {
  // Advance PRNG
  let x = randomSeed;
  x ^= x << 13;
  x ^= x >>> 17;
  x ^= x << 5;
  randomSeed = x & 0x7fffffff;

  const normalized = randomSeed / 0x7fffffff;

  if (args.length === 0) {
    return normalized;
  }

  if (args.length === 1) {
    const m = Math.trunc(luaToNumber(args[0]));
    if (m < 1) throw new Error('bad argument #1 to math.random (interval is empty)');
    return 1 + Math.floor(normalized * m);
  }

  const m = Math.trunc(luaToNumber(args[0]));
  const n = Math.trunc(luaToNumber(args[1]));
  if (m > n) throw new Error('bad argument #1 to math.random (interval is empty)');
  return m + Math.floor(normalized * (n - m + 1));
}

// ============================================================
// Lua 5.3 integer helpers
// ============================================================

export function mathToInteger(x) {
  const n = luaToNumber(x);
  if (!Number.isFinite(n)) return null;
  if (Math.floor(n) !== n) return null;
  if (n < -2147483648 || n > 2147483647) return null;
  return Math.trunc(n);
}

export function mathType(x) {
  if (typeof x === 'number' && Math.floor(x) === x) return 'integer';
  if (typeof x === 'number') return 'float';
  return null;
}

export function mathUlt(m, n) {
  // Unsigned less-than comparison
  const a = Math.trunc(luaToNumber(m)) >>> 0;
  const b = Math.trunc(luaToNumber(n)) >>> 0;
  return a < b;
}

// ============================================================
// Luau extensions
// ============================================================

export function mathClamp(x, min, max) {
  const n = luaToNumber(x);
  const lo = luaToNumber(min);
  const hi = luaToNumber(max);
  if (lo > hi) throw new Error('bad argument to math.clamp (min > max)');
  if (n < lo) return lo;
  if (n > hi) return hi;
  return n;
}

export function mathSign(x) {
  const n = luaToNumber(x);
  if (n > 0) return 1;
  if (n < 0) return -1;
  return 0;
}

export function mathRound(x) {
  const n = luaToNumber(x);
  return n >= 0 ? Math.floor(n + 0.5) : Math.ceil(n - 0.5);
}

/**
 * math.noise — Luau's Perlin noise.
 * Simplified: returns a deterministic pseudo-noise based on inputs.
 * Full Perlin noise would need a permutation table; we use a hash
 * instead so output is deterministic for the same inputs.
 */
export function mathNoise(x, y, z) {
  x = luaToNumber(x || 0);
  y = luaToNumber(y || 0);
  z = luaToNumber(z || 0);
  const h = Math.sin(x * 12.9898 + y * 78.233 + z * 37.719) * 43758.5453;
  return (h - Math.floor(h)) * 2 - 1;
}

// ============================================================
// Constants object
// ============================================================

export function makeMathLibrary() {
  return {
    abs: mathAbs,
    acos: mathAcos,
    asin: mathAsin,
    atan: mathAtan,
    atan2: mathAtan2,
    ceil: mathCeil,
    cos: mathCos,
    cosh: mathCosh,
    deg: mathDeg,
    exp: mathExp,
    floor: mathFloor,
    fmod: mathFmod,
    frexp: mathFrexp,
    ldexp: mathLdexp,
    log: mathLog,
    log10: mathLog10,
    max: mathMax,
    min: mathMin,
    modf: mathModf,
    pow: mathPow,
    rad: mathRad,
    random: mathRandom,
    randomseed: mathRandomSeed,
    sin: mathSin,
    sinh: mathSinh,
    sqrt: mathSqrt,
    tan: mathTan,
    tanh: mathTanh,
    tointeger: mathToInteger,
    type: mathType,
    ult: mathUlt,
    clamp: mathClamp,
    sign: mathSign,
    round: mathRound,
    noise: mathNoise,
    pi: mathPi,
    huge: mathHuge,
    maxinteger: mathMaxInteger,
    mininteger: mathMinInteger,
  };
}

export default {
  mathPi,
  mathHuge,
  mathMaxInteger,
  mathMinInteger,
  mathAbs,
  mathCeil,
  mathFloor,
  mathSqrt,
  mathExp,
  mathSin,
  mathCos,
  mathTan,
  mathAsin,
  mathAcos,
  mathAtan,
  mathAtan2,
  mathSinh,
  mathCosh,
  mathTanh,
  mathDeg,
  mathRad,
  mathLog,
  mathLog10,
  mathFmod,
  mathModf,
  mathFrexp,
  mathLdexp,
  mathMax,
  mathMin,
  mathPow,
  mathRandomSeed,
  mathRandom,
  mathToInteger,
  mathType,
  mathUlt,
  mathClamp,
  mathSign,
  mathRound,
  mathNoise,
  makeMathLibrary,
};