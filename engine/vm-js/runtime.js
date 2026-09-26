/**
 * Runtime operations for the VM.
 *
 * Every arithmetic, comparison, table, and closure operation goes
 * through here. Isolating them means the main dispatch loop stays
 * focused on control flow.
 */

export function luaAdd(a, b) {
  return luaToNumber(a) + luaToNumber(b);
}

export function luaSub(a, b) {
  return luaToNumber(a) - luaToNumber(b);
}

export function luaMul(a, b) {
  return luaToNumber(a) * luaToNumber(b);
}

export function luaDiv(a, b) {
  return luaToNumber(a) / luaToNumber(b);
}

export function luaMod(a, b) {
  // Lua modulo: result has sign of divisor, unlike JS %
  const x = luaToNumber(a);
  const y = luaToNumber(b);
  return x - Math.floor(x / y) * y;
}

export function luaPow(a, b) {
  return Math.pow(luaToNumber(a), luaToNumber(b));
}

export function luaUnm(a) {
  return -luaToNumber(a);
}

export function luaBand(a, b) {
  return (a | 0) & (b | 0);
}

export function luaBor(a, b) {
  return (a | 0) | (b | 0);
}

export function luaBxor(a, b) {
  return (a | 0) ^ (b | 0);
}

export function luaBnot(a) {
  return ~(a | 0);
}

export function luaShl(a, b) {
  return (a | 0) << (b & 31);
}

export function luaShr(a, b) {
  return (a | 0) >>> (b & 31);
}

export function luaEq(a, b) {
  return luaEquals(a, b);
}

export function luaNe(a, b) {
  return !luaEquals(a, b);
}

export function luaLt(a, b) {
  return luaLess(a, b);
}

export function luaLe(a, b) {
  return !luaLess(b, a);
}

export function luaGt(a, b) {
  return luaLess(b, a);
}

export function luaGe(a, b) {
  return !luaLess(a, b);
}

export function luaNot(a) {
  return !luaTruthy(a);
}

export function luaLen(a) {
  if (typeof a === 'string') return a.length;
  if (Array.isArray(a)) return a.length;
  if (a && typeof a === 'object') {
    // Lua length of a table with array part
    let n = 0;
    while (a[n + 1] !== undefined) n++;
    return n;
  }
  throw new Error('attempt to get length of ' + luaTypeName(a));
}

export function luaConcat(values, from, to) {
  const parts = [];
  for (let i = from; i <= to; i++) {
    parts.push(luaToString(values[i]));
  }
  return parts.join('');
}

export function luaGetTable(t, k) {
  if (t === null || t === undefined) {
    throw new Error('attempt to index a nil value');
  }
  return t[k];
}

export function luaSetTable(t, k, v) {
  if (t === null || t === undefined) {
    throw new Error('attempt to index a nil value');
  }
  t[k] = v;
}

/**
 * Truthiness in Lua: only `false` and `nil` are falsy.
 * Everything else, including 0 and "", is truthy.
 */
export function luaTruthy(v) {
  return v !== false && v !== null && v !== undefined;
}

export function luaEquals(a, b) {
  if (typeof a === 'number' && typeof b === 'number') {
    return a === b;
  }
  return a === b;
}

export function luaLess(a, b) {
  if (typeof a === 'number' && typeof b === 'number') return a < b;
  if (typeof a === 'string' && typeof b === 'string') return a < b;
  throw new Error('attempt to compare ' + luaTypeName(a) + ' with ' + luaTypeName(b));
}

export function luaToNumber(v) {
  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const n = Number(v);
    if (!isNaN(n)) return n;
  }
  throw new Error('attempt to perform arithmetic on ' + luaTypeName(v));
}

export function luaToString(v) {
  if (v === null || v === undefined) return 'nil';
  if (v === true) return 'true';
  if (v === false) return 'false';
  if (typeof v === 'number') {
    if (Number.isInteger(v)) return String(v);
    return String(v);
  }
  if (typeof v === 'string') return v;
  return String(v);
}

export function luaTypeName(v) {
  if (v === null || v === undefined) return 'nil';
  if (typeof v === 'boolean') return 'boolean';
  if (typeof v === 'number') return 'number';
  if (typeof v === 'string') return 'string';
  if (typeof v === 'function') return 'function';
  if (Array.isArray(v)) return 'table';
  if (typeof v === 'object') return 'table';
  return typeof v;
}

export default {
  luaAdd, luaSub, luaMul, luaDiv, luaMod, luaPow, luaUnm,
  luaBand, luaBor, luaBxor, luaBnot, luaShl, luaShr,
  luaEq, luaNe, luaLt, luaLe, luaGt, luaGe,
  luaNot, luaLen, luaConcat,
  luaGetTable, luaSetTable,
  luaTruthy, luaEquals, luaLess,
  luaToNumber, luaToString, luaTypeName,
};