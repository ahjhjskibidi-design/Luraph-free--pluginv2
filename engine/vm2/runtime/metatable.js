/**
 * Metatable runtime — full Lua metatable support.
 *
 * Every value in Lua can have a metatable. Tables have their own
 * (set via setmetatable). Other types share a single metatable
 * stored in the registry:
 *
 *   registry['string']  — metatable for all strings
 *   registry['number']  — metatable for all numbers
 *   registry['boolean'] — metatable for all booleans
 *   registry['function']— metatable for all functions
 *   registry['nil']     — nil has no metatable (always nil)
 *   registry['thread']  — coroutines (not applicable)
 *   registry['userdata']— userdata (not applicable)
 *
 * Supported metamethods:
 *   __index      — fallback for table reads
 *   __newindex   — fallback for table writes
 *   __call       — make a table callable
 *   __add        — addition
 *   __sub        — subtraction
 *   __mul        — multiplication
 *   __div        — division
 *   __mod        — modulo
 *   __pow        — power
 *   __unm        — unary minus
 *   __idiv       — integer division (Lua 5.3)
 *   __band       — bitwise AND
 *   __bor        — bitwise OR
 *   __bxor       — bitwise XOR
 *   __bnot       — bitwise NOT
 *   __shl        — left shift
 *   __shr        — right shift
 *   __concat     — concatenation
 *   __len        — length
 *   __eq         — equality
 *   __lt         — less-than
 *   __le         — less-than-or-equal
 *   __tostring   — tostring conversion
 *   __metatable  — what getmetatable returns
 *   __pairs      — pairs() customization (Lua 5.2+)
 *   __ipairs     — ipairs() customization (Lua 5.2+)
 *   __close      — to-be-closed variables (Lua 5.4)
 *   __gc         — garbage collection hook
 *
 * The VM injects its call handler at boot via setMetamethodContext,
 * so closures defined in Lua can be invoked from within metamethods.
 */

let context = null;

export function setMetamethodContext(ctx) {
  context = ctx;
}

export function getContext() {
  return context;
}

// ============================================================
// Metatable storage
// ============================================================

/**
 * The shared type metatables. In real Lua these live in the registry
 * table, which user code accesses via debug.getregistry. We expose
 * them via an internal object.
 */
const typeMetatables = {
  string: null,
  number: null,
  boolean: null,
  function: null,
  table: null,
  nil: null,
  thread: null,
  userdata: null,
};

export function getTypeMetatable(typeName) {
  return typeMetatables[typeName] || null;
}

export function setTypeMetatable(typeName, mt) {
  if (typeName === 'nil') {
    throw new Error('cannot set metatable for nil');
  }
  typeMetatables[typeName] = mt;
}

// ============================================================
// Getting / setting metatables
// ============================================================

/**
 * Get the metatable of a value.
 * Nil always returns nil. Tables use their __metatable field. Other
 * types read from the shared type metatable table.
 */
export function getMetatable(v) {
  if (v === null || v === undefined) return null;

  if (typeof v === 'object') {
    return v.__mt || null;
  }

  if (typeof v === 'function') {
    return v.__mt || typeMetatables.function;
  }

  if (v && v.__isClosure) {
    return v.__mt || typeMetatables.function;
  }

  const typeName = typeof v === 'string' ? 'string'
    : typeof v === 'number' ? 'number'
    : typeof v === 'boolean' ? 'boolean'
    : null;

  if (typeName) return typeMetatables[typeName];
  return null;
}

/**
 * Set the metatable of a value.
 * Only tables can have per-instance metatables. Other types use the
 * shared type metatable.
 */
export function setMetatable(v, mt) {
  if (v === null || v === undefined) {
    throw new Error('bad argument #1 to setmetatable (table expected, got nil)');
  }

  if (typeof v === 'object') {
    if (mt === null || mt === undefined) {
      delete v.__mt;
    } else {
      v.__mt = mt;
    }
    return v;
  }

  if (typeof v === 'function' || (v && v.__isClosure)) {
    if (mt === null || mt === undefined) {
      delete v.__mt;
    } else {
      v.__mt = mt;
    }
    return v;
  }

  const typeName = typeof v === 'string' ? 'string'
    : typeof v === 'number' ? 'number'
    : typeof v === 'boolean' ? 'boolean'
    : null;

  if (!typeName) {
    throw new Error('cannot set metatable of a ' + typeof v + ' value');
  }

  typeMetatables[typeName] = mt;
  return v;
}

/**
 * getmetatable(v) — Lua-level function.
 * Respects the __metatable field: if the metatable has a __metatable
 * key, that value is returned instead of the metatable.
 */
export function luaGetMetatable(v) {
  const mt = getMetatable(v);
  if (!mt) return null;
  if (mt.__metatable !== undefined) return mt.__metatable;
  return mt;
}

/**
 * setmetatable(t, mt) — Lua-level function.
 * Errors if the current metatable has a __metatable field (locked).
 */
export function luaSetMetatable(t, mt) {
  if (t === null || t === undefined) {
    throw new Error('bad argument #1 to setmetatable (table expected, got nil)');
  }
  const current = getMetatable(t);
  if (current && current.__metatable !== undefined) {
    throw new Error('cannot change a protected metatable');
  }
  if (mt !== null && mt !== undefined && typeof mt !== 'object') {
    throw new Error('bad argument #2 to setmetatable (nil or table expected)');
  }
  return setMetatable(t, mt);
}

// ============================================================
// Metamethod lookup and invocation
// ============================================================

/**
 * Look up a metamethod name in a value's metatable.
 * Returns the function or undefined.
 */
export function lookupMetamethod(v, name) {
  const mt = getMetatable(v);
  if (!mt) return undefined;
  const fn = mt[name];
  if (fn === undefined || fn === null) return undefined;
  return fn;
}

/**
 * Find a metamethod in either a or b. Lua rules: for binary
 * operations, first check a, then b. For unary, only check a.
 * Returns { fn, target, other } or null.
 */
export function findBinaryMetamethod(a, b, name) {
  const fnA = lookupMetamethod(a, name);
  if (fnA) return { fn: fnA, target: a, other: b };

  const fnB = lookupMetamethod(b, name);
  if (fnB) return { fn: fnB, target: a, other: b };

  return null;
}

export function findUnaryMetamethod(a, name) {
  const fn = lookupMetamethod(a, name);
  if (fn) return { fn, target: a };
  return null;
}

/**
 * Call a metamethod with the given arguments.
 * The result may itself require metamethod lookup if the fn is a
 * Lua closure — the VM context handles that.
 */
export function callMetamethod(fn, args) {
  if (typeof fn === 'function') {
    return fn(...args);
  }
  if (fn && fn.__isClosure) {
    if (!context || typeof context.callClosure !== 'function') {
      throw new Error('cannot invoke a Lua closure metamethod outside the VM');
    }
    return context.callClosure(fn, args);
  }
  throw new Error('attempt to call a ' + typeof fn + ' value as a metamethod');
}

/**
 * Convenience: find the metamethod and call it.
 * Returns undefined if no metamethod is defined.
 */
export function tryBinaryMetamethod(a, b, name) {
  const found = findBinaryMetamethod(a, b, name);
  if (!found) return undefined;
  return callMetamethod(found.fn, [found.target, found.other]);
}

export function tryUnaryMetamethod(a, name) {
  const found = findUnaryMetamethod(a, name);
  if (!found) return undefined;
  return callMetamethod(found.fn, [found.target]);
}

// ============================================================
// Arithmetic metamethods
// ============================================================

export function metamethodAdd(a, b) { return tryBinaryMetamethod(a, b, '__add'); }
export function metamethodSub(a, b) { return tryBinaryMetamethod(a, b, '__sub'); }
export function metamethodMul(a, b) { return tryBinaryMetamethod(a, b, '__mul'); }
export function metamethodDiv(a, b) { return tryBinaryMetamethod(a, b, '__div'); }
export function metamethodMod(a, b) { return tryBinaryMetamethod(a, b, '__mod'); }
export function metamethodPow(a, b) { return tryBinaryMetamethod(a, b, '__pow'); }
export function metamethodIDiv(a, b) { return tryBinaryMetamethod(a, b, '__idiv'); }
export function metamethodUnm(a) { return tryUnaryMetamethod(a, '__unm'); }

// ============================================================
// Bitwise metamethods
// ============================================================

export function metamethodBand(a, b) { return tryBinaryMetamethod(a, b, '__band'); }
export function metamethodBor(a, b) { return tryBinaryMetamethod(a, b, '__bor'); }
export function metamethodBxor(a, b) { return tryBinaryMetamethod(a, b, '__bxor'); }
export function metamethodBnot(a) { return tryUnaryMetamethod(a, '__bnot'); }
export function metamethodShl(a, b) { return tryBinaryMetamethod(a, b, '__shl'); }
export function metamethodShr(a, b) { return tryBinaryMetamethod(a, b, '__shr'); }

// ============================================================
// Comparison metamethods
// ============================================================

export function metamethodEq(a, b) { return tryBinaryMetamethod(a, b, '__eq'); }
export function metamethodLt(a, b) { return tryBinaryMetamethod(a, b, '__lt'); }
export function metamethodLe(a, b) { return tryBinaryMetamethod(a, b, '__le'); }

// ============================================================
// Table metamethods
// ============================================================

export function metamethodIndex(t, k) {
  const fn = lookupMetamethod(t, '__index');
  if (!fn) return undefined;
  if (typeof fn === 'function' || (fn && fn.__isClosure)) {
    return callMetamethod(fn, [t, k]);
  }
  // __index is a table: recurse
  return tableIndexWithMetatable(fn, k);
}

function tableIndexWithMetatable(t, k) {
  if (t === null || t === undefined) return undefined;
  if (typeof t !== 'object') return undefined;
  const direct = t[k];
  if (direct !== undefined) return direct;
  return metamethodIndex(t, k);
}

export function metamethodNewIndex(t, k, v) {
  const fn = lookupMetamethod(t, '__newindex');
  if (!fn) {
    t[k] = v;
    return;
  }
  if (typeof fn === 'function' || (fn && fn.__isClosure)) {
    callMetamethod(fn, [t, k, v]);
    return;
  }
  // __newindex is a table: set into it
  fn[k] = v;
}

export function metamethodCall(fn, args) {
  const mm = lookupMetamethod(fn, '__call');
  if (!mm) {
    throw new Error('attempt to call a table value (no __call metamethod)');
  }
  return callMetamethod(mm, [fn, ...args]);
}

export function metamethodLen(v) {
  const mm = tryUnaryMetamethod(v, '__len');
  if (mm !== undefined) return mm;
  throw new Error('no __len metamethod for ' + typeof v);
}

export function metamethodConcat(a, b) {
  return tryBinaryMetamethod(a, b, '__concat');
}

// ============================================================
// tostring / pairs metamethods
// ============================================================

export function metamethodToString(v) {
  const mm = tryUnaryMetamethod(v, '__tostring');
  if (mm !== undefined) return mm;
  return null;
}

export function metamethodPairs(t) {
  const mm = tryUnaryMetamethod(t, '__pairs');
  if (mm !== undefined) return mm;
  return null;
}

export function metamethodIPairs(t) {
  const mm = tryUnaryMetamethod(t, '__ipairs');
  if (mm !== undefined) return mm;
  return null;
}

// ============================================================
// Library object
// ============================================================

export function makeMetatableLibrary() {
  return {
    getmetatable: luaGetMetatable,
    setmetatable: luaSetMetatable,
    rawget: (t, k) => t[k],
    rawset: (t, k, v) => { t[k] = v; return t; },
    rawequal: (a, b) => a === b,
    rawlen: (v) => {
      if (typeof v === 'string') return v.length;
      if (Array.isArray(v)) return v.length;
      if (v && typeof v === 'object') {
        let n = 0;
        while (v[n + 1] !== undefined) n++;
        return n;
      }
      throw new Error('table expected');
    },
  };
}

export default {
  setMetamethodContext,
  getContext,
  getTypeMetatable,
  setTypeMetatable,
  getMetatable,
  setMetatable,
  luaGetMetatable,
  luaSetMetatable,
  lookupMetamethod,
  findBinaryMetamethod,
  findUnaryMetamethod,
  callMetamethod,
  tryBinaryMetamethod,
  tryUnaryMetamethod,
  metamethodAdd,
  metamethodSub,
  metamethodMul,
  metamethodDiv,
  metamethodMod,
  metamethodPow,
  metamethodIDiv,
  metamethodUnm,
  metamethodBand,
  metamethodBor,
  metamethodBxor,
  metamethodBnot,
  metamethodShl,
  metamethodShr,
  metamethodEq,
  metamethodLt,
  metamethodLe,
  metamethodIndex,
  metamethodNewIndex,
  metamethodCall,
  metamethodLen,
  metamethodConcat,
  metamethodToString,
  metamethodPairs,
  metamethodIPairs,
  makeMetatableLibrary,
};