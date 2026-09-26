/**
 * Base standard library — Lua's global functions.
 *
 * The base library is the set of functions available without any
 * prefix. It covers:
 *
 *   print, warn                        — output
 *   type, tostring, tonumber           — type conversion
 *   assert, error, pcall, xpcall       — error handling
 *   select                             — argument selection
 *   rawget, rawset, rawequal, rawlen   — raw table ops
 *   getmetatable, setmetatable         — metatable access
 *   pairs, ipairs, next                — iteration
 *   load, loadstring, loadfile, dofile — code loading
 *   collectgarbage                     — GC control
 *   _G, _VERSION                       — environment, version
 *   unpack                             — Lua 5.1 unpack
 *
 * The VM injects a `host` object at construction. This host provides:
 *   host.write(text)   — where print sends output
 *   host.warn(text)    — where warn sends output
 *   host.callAny(fn, args) — call a JS function or Lua closure
 *   host.loadString(source, chunkname) — compile and return a closure
 *   host.getGlobals()  — the global environment table
 *   host.getRegistry() — the registry table
 */

import {
  luaTypeName,
  luaTruthy,
  luaToString,
  luaToNumber,
  luaEquals,
  tableGet,
  tableSet,
  rawLength,
  tableLength,
  tableRawGet,
  tableRawSet,
  tableEquals,
  tableNext,
  tablePairs,
  tableIPairs,
  luaGetMetatable,
  luaSetMetatable,
  luaError,
  luaAssert,
  luaPcall,
  luaXpcall,
  makeErrorLibrary,
  VMError,
} from '../runtime/index.js';

// ============================================================
// Output
// ============================================================

/**
 * print(...) — writes tab-separated arguments to stdout, then newline.
 */
export function luaPrint(host, ...args) {
  const parts = args.map(luaToString);
  const text = parts.join('\t') + '\n';
  if (host && typeof host.write === 'function') {
    host.write(text);
  } else {
    // eslint-disable-next-line no-console
    console.log(parts.join('\t'));
  }
}

/**
 * warn(...) — writes a warning to stderr. In our host this is the
 * same stream as print but tagged with a prefix.
 */
export function luaWarn(host, ...args) {
  const parts = args.map(luaToString);
  const text = 'warn: ' + parts.join('\t') + '\n';
  if (host && typeof host.warn === 'function') {
    host.warn(text);
  } else if (host && typeof host.write === 'function') {
    host.write(text);
  } else {
    // eslint-disable-next-line no-console
    console.warn(text.trim());
  }
}

// ============================================================
// Type conversion
// ============================================================

/**
 * type(v) — returns the type name.
 */
export function luaType(v) {
  return luaTypeName(v);
}

/**
 * tostring(v) — converts to string, respecting __tostring.
 */
export function luaTostring(v) {
  // Metamethod lookup for tables
  if (v !== null && typeof v === 'object') {
    const mt = luaGetMetatable(v);
    if (mt && mt.__tostring !== undefined) {
      if (typeof mt.__tostring === 'function') return mt.__tostring(v);
      // For a Lua closure, host.callAny is required; fall through if absent
    }
  }
  return luaToString(v);
}

/**
 * tonumber(v [, base])
 *
 * Converts v to a number. With base 2-36, parses v as an integer in
 * that base. Without base, accepts decimal, hex (0x), exponent, etc.
 */
export function luaTonumber(v, base) {
  if (base !== undefined) {
    const b = Math.trunc(luaToNumber(base));
    if (b < 2 || b > 36) {
      throw new Error('bad argument #2 to tonumber (base out of range)');
    }
    if (typeof v !== 'string') return null;
    const str = v.trim();
    if (!str) return null;
    let sign = 1;
    let s = str;
    if (s[0] === '-') { sign = -1; s = s.slice(1); }
    else if (s[0] === '+') { s = s.slice(1); }
    if (!s) return null;
    let n = 0;
    for (const ch of s) {
      const digit = parseInt(ch, 36);
      if (Number.isNaN(digit) || digit >= b) return null;
      n = n * b + digit;
    }
    return sign * n;
  }

  if (typeof v === 'number') return v;
  if (typeof v === 'string') {
    const str = v.trim();
    if (!str) return null;
    // Hex
    if (/^[-+]?0[xX][0-9a-fA-F]+$/.test(str)) {
      const neg = str[0] === '-';
      const hex = str.replace(/^[-+]?0[xX]/, '');
      const n = parseInt(hex, 16);
      return neg ? -n : n;
    }
    // Decimal
    if (/^[-+]?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?$/.test(str)) {
      return Number(str);
    }
    return null;
  }
  return null;
}

// ============================================================
// Error handling
// ============================================================

/**
 * assert(v, message, ...) — error if v is falsy.
 * Returns all arguments when v is truthy.
 */
export function luaGlobalAssert(v, msg, ...rest) {
  if (luaTruthy(v)) return [v, msg, ...rest];
  throw new VMError(msg === undefined ? 'assertion failed!' : msg);
}

/**
 * error(msg [, level]) — raise an error.
 */
export function luaGlobalError(msg, level) {
  throw new VMError(msg === undefined ? null : msg, {
    level: level === undefined ? 1 : luaToNumber(level),
  });
}

/**
 * pcall(fn, ...) — protected call.
 */
export function luaGlobalPcall(host, fn, ...args) {
  try {
    const result = callHost(host, fn, args);
    return [true, ...normalizeResults(result)];
  } catch (e) {
    if (e instanceof VMError) return [false, e.value];
    return [false, e && e.message ? e.message : String(e)];
  }
}

/**
 * xpcall(fn, handler, ...) — protected call with custom handler.
 */
export function luaGlobalXpcall(host, fn, handler, ...args) {
  try {
    const result = callHost(host, fn, args);
    return [true, ...normalizeResults(result)];
  } catch (e) {
    const value = e instanceof VMError ? e.value : (e && e.message ? e.message : String(e));
    try {
      const handled = callHost(host, handler, [value]);
      return [false, ...normalizeResults(handled)];
    } catch (e2) {
      const value2 = e2 instanceof VMError ? e2.value : (e2 && e2.message ? e2.message : String(e2));
      return [false, value2];
    }
  }
}

function callHost(host, fn, args) {
  if (host && typeof host.callAny === 'function') {
    return host.callAny(fn, args);
  }
  if (typeof fn === 'function') return fn(...args);
  throw new VMError('attempt to call a ' + luaTypeName(fn) + ' value');
}

function normalizeResults(result) {
  if (result === undefined) return [];
  if (Array.isArray(result)) return result;
  return [result];
}

// ============================================================
// select
// ============================================================

/**
 * select(n, ...)
 *
 * If n is a positive number, returns all arguments from position n
 * onward. If n is the string "#", returns the count of extra
 * arguments.
 */
export function luaSelect(n, ...args) {
  if (n === '#') return args.length;
  const i = Math.trunc(luaToNumber(n));
  if (i < 0) {
    const start = args.length + i;
    if (start < 0) throw new Error('bad argument #1 to select (index out of range)');
    return args.slice(start);
  }
  if (i < 1) throw new Error('bad argument #1 to select (index out of range)');
  if (i > args.length) return [];
  return args.slice(i - 1);
}

// ============================================================
// Raw table access
// ============================================================

export function luaRawget(t, k) {
  return tableRawGet(t, k);
}

export function luaRawset(t, k, v) {
  return tableRawSet(t, k, v);
}

export function luaRawequal(a, b) {
  return a === b;
}

export function luaRawlen(v) {
  if (typeof v === 'string') return v.length;
  return rawLength(v);
}

// ============================================================
// Metatables
// ============================================================

export function luaGlobalGetmetatable(v) {
  return luaGetMetatable(v);
}

export function luaGlobalSetmetatable(t, mt) {
  return luaSetMetatable(t, mt);
}

// ============================================================
// Iteration
// ============================================================

export function luaNext(t, k) {
  return tableNext(t, k);
}

export function luaPairs(t) {
  return tablePairs(t);
}

export function luaIpairs(t) {
  return tableIPairs(t);
}

// ============================================================
// Code loading
// ============================================================

/**
 * loadstring(source [, chunkname])
 *
 * Compiles source and returns a closure, or (nil, error) on parse
 * failure.
 */
export function luaLoadstring(host, source, chunkname) {
  if (typeof source !== 'string') {
    throw new Error('bad argument #1 to loadstring (string expected)');
  }
  if (!host || typeof host.loadString !== 'function') {
    return [null, 'loadstring is not available in this sandbox'];
  }
  try {
    const closure = host.loadString(source, chunkname || source);
    return [closure];
  } catch (e) {
    return [null, e.message || String(e)];
  }
}

/**
 * load(reader [, chunkname])
 *
 * Lua 5.2+ loader. Accepts a function that returns pieces of source.
 */
export function luaLoad(host, reader, chunkname) {
  let source = '';
  for (;;) {
    const piece = callHost(host, reader, []);
    if (piece === null || piece === undefined) break;
    source += luaToString(piece);
  }
  return luaLoadstring(host, source, chunkname);
}

/**
 * loadfile([filename]) — disabled in sandbox.
 */
export function luaLoadfile(host, filename) {
  return [null, 'loadfile is not available in this sandbox'];
}

/**
 * dofile([filename]) — disabled in sandbox.
 */
export function luaDofile(host, filename) {
  throw new Error('dofile is not available in this sandbox');
}

// ============================================================
// collectgarbage
// ============================================================

/**
 * collectgarbage([opt [, arg]])
 *
 * In Lua this controls the garbage collector. JS has its own GC, so
 * we accept the call and report reasonable values.
 */
export function luaCollectgarbage(opt, arg) {
  opt = opt === undefined ? 'collect' : luaToString(opt);
  switch (opt) {
    case 'collect':
    case 'step':
      return false;
    case 'count':
      return 0;
    case 'stop':
    case 'restart':
      return true;
    case 'isrunning':
      return true;
    default:
      throw new Error("bad argument #1 to collectgarbage (invalid option '" + opt + "')");
  }
}

// ============================================================
// Library object
// ============================================================

/**
 * Build the base library object. All functions are bound to the host
 * so the VM does not need to pass it at each call.
 */
export function makeBaseLibrary(host, options) {
  options = options || {};
  const globals = options.globals || {};

  return {
    print: (...args) => luaPrint(host, ...args),
    warn: (...args) => luaWarn(host, ...args),
    type: luaType,
    tostring: luaTostring,
    tonumber: luaTonumber,
    assert: luaGlobalAssert,
    error: luaGlobalError,
    pcall: (fn, ...args) => luaGlobalPcall(host, fn, ...args),
    xpcall: (fn, handler, ...args) => luaGlobalXpcall(host, fn, handler, ...args),
    select: luaSelect,
    rawget: luaRawget,
    rawset: luaRawset,
    rawequal: luaRawequal,
    rawlen: luaRawlen,
    getmetatable: luaGlobalGetmetatable,
    setmetatable: luaGlobalSetMetatable,
    next: luaNext,
    pairs: luaPairs,
    ipairs: luaIpairs,
    loadstring: (src, name) => luaLoadstring(host, src, name),
    load: (reader, name) => luaLoad(host, reader, name),
    loadfile: (name) => luaLoadfile(host, name),
    dofile: (name) => luaDofile(host, name),
    collectgarbage: luaCollectgarbage,
    unpack: (t, i, j) => {
      i = i === undefined ? 1 : Math.trunc(luaToNumber(i));
      j = j === undefined ? rawLength(t) : Math.trunc(luaToNumber(j));
      const out = [];
      for (let k = i; k <= j; k++) out.push(t[k]);
      return out;
    },
    _G: globals,
    _VERSION: 'Lua 5.1 (vm2)',
  };
}

export default {
  luaPrint,
  luaWarn,
  luaType,
  luaTostring,
  luaTonumber,
  luaGlobalAssert,
  luaGlobalError,
  luaGlobalPcall,
  luaGlobalXpcall,
  luaSelect,
  luaRawget,
  luaRawset,
  luaRawequal,
  luaRawlen,
  luaGlobalGetmetatable,
  luaGlobalSetMetatable,
  luaNext,
  luaPairs,
  luaIpairs,
  luaLoadstring,
  luaLoad,
  luaLoadfile,
  luaDofile,
  luaCollectgarbage,
  makeBaseLibrary,
};