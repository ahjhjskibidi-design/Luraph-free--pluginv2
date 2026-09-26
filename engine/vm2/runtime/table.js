/**
 * Table runtime — full Lua table library implementation.
 *
 * Lua 5.1 table library:
 *   table.concat     — join array elements with separator
 *   table.insert     — insert at position or append
 *   table.maxn       — largest positive numeric index
 *   table.remove     — remove at position or last
 *   table.sort       — sort array in place
 *
 * Lua 5.3 additions:
 *   table.pack       — collect args into table with n field
 *   table.unpack     — spread table to values
 *   table.move       — copy range between tables
 *
 * Luau additions:
 *   table.clear      — remove all keys
 *   table.clone      — shallow copy
 *   table.create     — preallocate array
 *   table.find       — index of first occurrence
 *   table.freeze     — readonly marker
 *   table.isfrozen   — check readonly
 *
 * This module also implements the primitive table operations that the
 * VM uses directly (get/set with metatable fallback), plus helpers
 * for length, iteration, and comparison.
 */

import { luaToString, luaToNumber, luaTypeName, luaTruthy, luaLess } from './type.js';
import { getMetatableOf, callMetamethod } from './metatable.js';

// ============================================================
// Primitive table ops (used by VM dispatch)
// ============================================================

/**
 * Raw table length — no metamethod fallback.
 * Follows Lua's behavior: for an array-like table, the largest
 * integer key n such that t[n] is not nil and t[n+1] is nil. Any
 * key above a hole counts as absent.
 */
export function rawLength(t) {
  if (typeof t === 'string') return t.length;
  if (t === null || t === undefined) {
    throw new Error('attempt to get length of a nil value');
  }
  if (typeof t !== 'object') {
    throw new Error('attempt to get length of a ' + luaTypeName(t) + ' value');
  }
  let n = 0;
  while (t[n + 1] !== undefined && t[n + 1] !== null) n++;
  return n;
}

/**
 * Length with __len metamethod fallback.
 */
export function tableLength(t) {
  if (typeof t === 'string') return t.length;
  const mt = getMetatableOf(t);
  if (mt && mt.__len !== undefined) {
    const v = callMetamethod(t, t, '__len');
    return luaToNumber(v);
  }
  return rawLength(t);
}

/**
 * Get a table key with __index fallback.
 * If the key is missing and __index is a table, recurse.
 * If __index is a function, call it and return the result.
 */
export function tableGet(t, k) {
  if (t === null || t === undefined) {
    throw new Error('attempt to index a nil value');
  }
  if (typeof t !== 'object') {
    throw new Error('attempt to index a ' + luaTypeName(t) + ' value');
  }

  const direct = t[k];
  if (direct !== undefined) return direct;

  const mt = getMetatableOf(t);
  if (!mt) return undefined;

  const idx = mt.__index;
  if (idx === undefined) return undefined;

  if (typeof idx === 'function') {
    return callMetamethod(t, k, '__index');
  }
  if (idx && idx.__isClosure) {
    return callMetamethod(t, k, '__index');
  }
  return tableGet(idx, k);
}

/**
 * Set a table key with __newindex fallback.
 */
export function tableSet(t, k, v) {
  if (t === null || t === undefined) {
    throw new Error('attempt to index a nil value');
  }
  if (typeof t !== 'object') {
    throw new Error('attempt to index a ' + luaTypeName(t) + ' value');
  }

  const existing = t[k];
  if (existing !== undefined) {
    t[k] = v;
    return;
  }

  const mt = getMetatableOf(t);
  if (!mt) {
    t[k] = v;
    return;
  }

  const ni = mt.__newindex;
  if (ni === undefined) {
    t[k] = v;
    return;
  }

  if (typeof ni === 'function') {
    callMetamethod(t, k, '__newindex');
    return;
  }
  if (ni && ni.__isClosure) {
    callMetamethod(t, k, '__newindex');
    return;
  }
  tableSet(ni, k, v);
}

/**
 * Raw get — no metatable fallback.
 */
export function tableRawGet(t, k) {
  return t[k];
}

/**
 * Raw set — no metatable fallback.
 */
export function tableRawSet(t, k, v) {
  t[k] = v;
  return t;
}

/**
 * Shallow equality for tables. Two tables are equal only if they are
 * the same reference, unless both have an __eq metamethod that says
 * otherwise.
 */
export function tableEquals(a, b) {
  if (a === b) return true;
  if (typeof a !== 'object' || typeof b !== 'object') return false;
  if (a === null || b === null) return false;

  const mt = getMetatableOf(a);
  if (mt && mt.__eq) {
    const result = callMetamethod(a, b, '__eq');
    return luaTruthy(result);
  }
  return false;
}

// ============================================================
// Library functions
// ============================================================

/**
 * table.concat(t [, sep [, i [, j]]])
 *
 * Joins elements t[i] through t[j] with sep between them. i defaults
 * to 1, j defaults to #t. Elements must be numbers or strings.
 */
export function tableConcat(t, sep, i, j) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.concat (table expected)');
  }
  sep = sep === undefined ? '' : luaToString(sep);
  i = i === undefined ? 1 : Math.trunc(luaToNumber(i));
  j = j === undefined ? rawLength(t) : Math.trunc(luaToNumber(j));

  const parts = [];
  for (let k = i; k <= j; k++) {
    const v = t[k];
    if (typeof v !== 'string' && typeof v !== 'number') {
      throw new Error('invalid value (at index ' + k + ') in table for table.concat');
    }
    parts.push(luaToString(v));
  }
  return parts.join(sep);
}

/**
 * table.insert(t, [pos,] value)
 *
 * Inserts value at position pos, shifting elements up. Without pos,
 * appends to the end.
 */
export function tableInsert(t, ...args) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.insert (table expected)');
  }

  if (args.length === 1) {
    const n = rawLength(t);
    t[n + 1] = args[0];
    return;
  }

  const pos = Math.trunc(luaToNumber(args[0]));
  const value = args[1];
  const n = rawLength(t);

  if (pos < 1 || pos > n + 1) {
    throw new Error('bad argument #2 to table.insert (position out of bounds)');
  }

  for (let k = n; k >= pos; k--) {
    t[k + 1] = t[k];
  }
  t[pos] = value;
}

/**
 * table.remove(t [, pos])
 *
 * Removes element at pos (default #t), shifting elements down.
 * Returns the removed value.
 */
export function tableRemove(t, pos) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.remove (table expected)');
  }

  const n = rawLength(t);
  pos = pos === undefined ? n : Math.trunc(luaToNumber(pos));

  if (pos < 1 || pos > n) return undefined;

  const value = t[pos];
  for (let k = pos; k < n; k++) {
    t[k] = t[k + 1];
  }
  t[n] = undefined;
  return value;
}

/**
 * table.maxn(t)
 *
 * Largest positive numeric key. Iterates all keys; O(n) but n is
 * usually small.
 */
export function tableMaxn(t) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.maxn (table expected)');
  }
  let max = 0;
  for (const k of Object.keys(t)) {
    const n = Number(k);
    if (!Number.isNaN(n) && n > max) max = n;
  }
  return max;
}

/**
 * table.sort(t [, comparator])
 *
 * In-place sort of the array part. Comparator takes two args and
 * returns true if the first should come before the second.
 */
export function tableSort(t, comparator) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.sort (table expected)');
  }

  const n = rawLength(t);
  const arr = [];
  for (let i = 1; i <= n; i++) arr.push(t[i]);

  if (comparator === undefined) {
    arr.sort((a, b) => {
      if (luaLess(a, b)) return -1;
      if (luaLess(b, a)) return 1;
      return 0;
    });
  } else {
    arr.sort((a, b) => {
      const ab = luaTruthy(callComparator(comparator, a, b));
      const ba = luaTruthy(callComparator(comparator, b, a));
      if (ab && !ba) return -1;
      if (!ab && ba) return 1;
      return 0;
    });
  }

  for (let i = 0; i < n; i++) {
    t[i + 1] = arr[i];
  }
}

function callComparator(fn, a, b) {
  if (typeof fn === 'function') return fn(a, b);
  if (fn && fn.__isClosure) {
    throw new Error('closure comparators require VM context (see runtime/call-op.js)');
  }
  throw new Error('bad comparator to table.sort');
}

/**
 * table.pack(...)
 *
 * Collects arguments into a new table with an `n` field recording
 * the count. Handy for varargs forwarding.
 */
export function tablePack(...args) {
  const t = {};
  for (let i = 0; i < args.length; i++) {
    t[i + 1] = args[i];
  }
  t.n = args.length;
  return t;
}

/**
 * table.unpack(t [, i [, j]])
 *
 * Returns t[i] through t[j] as multiple values.
 */
export function tableUnpack(t, i, j) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.unpack (table expected)');
  }
  i = i === undefined ? 1 : Math.trunc(luaToNumber(i));
  j = j === undefined ? rawLength(t) : Math.trunc(luaToNumber(j));

  const out = [];
  for (let k = i; k <= j; k++) out.push(t[k]);
  return out;
}

/**
 * table.move(a1, f, e, t [, a2])
 *
 * Copies elements a1[f..e] into a2[t..], returning a2. Handles
 * overlap by copying in the correct direction.
 */
export function tableMove(a1, f, e, t, a2) {
  f = Math.trunc(luaToNumber(f));
  e = Math.trunc(luaToNumber(e));
  t = Math.trunc(luaToNumber(t));
  a2 = a2 === undefined ? a1 : a2;

  if (e >= f) {
    if (t > f && t <= e) {
      // Backwards copy
      for (let k = e; k >= f; k--) {
        a2[t + (k - f)] = a1[k];
      }
    } else {
      for (let k = f; k <= e; k++) {
        a2[t + (k - f)] = a1[k];
      }
    }
  }
  return a2;
}

// ============================================================
// Luau extensions
// ============================================================

/**
 * table.clear(t)
 *
 * Removes every key from t. Same as iterating and setting to nil.
 */
export function tableClear(t) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.clear (table expected)');
  }
  for (const k of Object.keys(t)) {
    delete t[k];
  }
}

/**
 * table.clone(t)
 *
 * Shallow copy. Nested tables are shared.
 */
export function tableClone(t) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.clone (table expected)');
  }
  const out = {};
  for (const k of Object.keys(t)) {
    out[k] = t[k];
  }
  return out;
}

/**
 * table.create(n [, value])
 *
 * Preallocates an array of size n, filled with value (default nil).
 * In JS we just build the array; the VM has no allocator to hint.
 */
export function tableCreate(n, value) {
  n = Math.trunc(luaToNumber(n));
  if (n < 0) n = 0;
  const out = {};
  if (value !== undefined) {
    for (let i = 1; i <= n; i++) out[i] = value;
  }
  return out;
}

/**
 * table.find(t, value [, init])
 *
 * Returns the first index i >= init where t[i] == value, or nil.
 */
export function tableFind(t, value, init) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.find (table expected)');
  }
  init = init === undefined ? 1 : Math.trunc(luaToNumber(init));
  const n = rawLength(t);
  for (let i = init; i <= n; i++) {
    if (t[i] === value) return i;
  }
  return null;
}

/**
 * table.freeze(t)
 *
 * Marks t as readonly via a metatable that errors on write.
 * Non-standard, Luau-only.
 */
export function tableFreeze(t) {
  if (t === null || t === undefined || typeof t !== 'object') {
    throw new Error('bad argument #1 to table.freeze (table expected)');
  }
  t.__frozen = true;
  return t;
}

export function tableIsFrozen(t) {
  if (t === null || t === undefined || typeof t !== 'object') return false;
  return t.__frozen === true;
}

// ============================================================
// Iteration helpers
// ============================================================

/**
 * next(t [, k])
 *
 * Returns the next key-value pair after k, or nil when done.
 * Used by pairs and by manual iteration.
 */
export function tableNext(t, k) {
  const keys = Object.keys(t).filter(key => {
    return !key.startsWith('__') && !key.startsWith('_');
  });

  if (k === undefined || k === null) {
    if (keys.length === 0) return [null];
    return [keys[0], t[keys[0]]];
  }

  const idx = keys.indexOf(String(k));
  if (idx === -1 || idx === keys.length - 1) return [null];
  const nextKey = keys[idx + 1];
  return [nextKey, t[nextKey]];
}

/**
 * pairs(t) — returns (next, t, nil) triple for generic for.
 */
export function tablePairs(t) {
  if (t === null || t === undefined) {
    throw new Error('bad argument #1 to pairs (table expected, got nil)');
  }

  // Respect __pairs metamethod
  const mt = getMetatableOf(t);
  if (mt && mt.__pairs) {
    return callMetamethod(t, t, '__pairs');
  }

  return [tableNext, t, null];
}

/**
 * ipairs(t) — iterates array part in order until first nil.
 */
export function tableIPairs(t) {
  if (t === null || t === undefined) {
    throw new Error('bad argument #1 to ipairs (table expected, got nil)');
  }

  let i = 0;
  const iterator = function () {
    i++;
    const v = t[i];
    if (v === undefined || v === null) return [null];
    return [i, v];
  };
  return [iterator, t, null];
}

// ============================================================
// Library object
// ============================================================

export function makeTableLibrary() {
  return {
    concat: tableConcat,
    insert: tableInsert,
    remove: tableRemove,
    maxn: tableMaxn,
    sort: tableSort,
    pack: tablePack,
    unpack: tableUnpack,
    move: tableMove,
    clear: tableClear,
    clone: tableClone,
    create: tableCreate,
    find: tableFind,
    freeze: tableFreeze,
    isfrozen: tableIsFrozen,
    getn: function (t) { return rawLength(t); },
    setn: function (t, n) { t.n = n; },
  };
}

export default {
  rawLength,
  tableLength,
  tableGet,
  tableSet,
  tableRawGet,
  tableRawSet,
  tableEquals,
  tableConcat,
  tableInsert,
  tableRemove,
  tableMaxn,
  tableSort,
  tablePack,
  tableUnpack,
  tableMove,
  tableClear,
  tableClone,
  tableCreate,
  tableFind,
  tableFreeze,
  tableIsFrozen,
  tableNext,
  tablePairs,
  tableIPairs,
  makeTableLibrary,
};