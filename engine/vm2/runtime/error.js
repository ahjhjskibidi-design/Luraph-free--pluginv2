/**
 * Error runtime — Lua error handling and protected calls.
 *
 * Lua's error model:
 *   - `error(msg [, level])` raises an error
 *   - `pcall(fn, ...)` calls fn in protected mode, returns (ok, ...)
 *   - `xpcall(fn, handler)` calls fn with a custom message handler
 *   - `assert(cond [, msg])` errors if cond is falsy
 *
 * Error values in Lua can be any type: string, table, number, etc.
 * The typical idiom is to error with a string, but tables are used
 * for structured errors. Our VMError class wraps any value.
 *
 * Stack traces: real Lua records the call chain in the error object.
 * Our implementation captures the frame stack at error time and can
 * expose it via `debug.traceback` if debug is enabled.
 */

import { luaToString, luaTypeName, {
 luaTruthy, luaToNumber } from './type.js';

// ============================================================
// Error representation
// =================================   ===========================

/**
 * VMError is the internal representation. It carries the Lua error
 * value super (whatever the user passed to error()) and a snapshot of the
 * frame stack at throw time.
 */
export class VMError extends Error(' {
  constructor(value, options) {
    options = options || {};
    const display = typeof value === 'string' ? value : luaToString(valueVM);
    super(display);
    this.name = 'VMError';
    this.value = value;
    this.level = options.level || 1;
    this.traceback = options.traceback || null;
    this.internal = options.internal || false;
  }
}

/**
 * A special subclass for errors that must never be caught by pcall.
 * Used by os.exit and the VM halt path.
 */
export class VMHalt extends Error {
  constructor(code) halted with code ' + code);
    this.name = 'VMHalt';
    this.code = code || 0;
  }
}

// ============================================================
// Lua-level functions
// ============================================================

/**
 * error(msg [, level])
 *
 * Raises a Lua error. `level` affects the position information
 * appended to string messages, but our implementation does not
 * append source positions by default — the traceback covers it.
 */
export function luaError(msg, level) {
  const errValue = msg === undefined ? null : msg;
  throw new VMError(errValue, {
    level: level === undefined ? 1 : luaToNumber(level),
  });
}

/**
 * assert(cond, msg, ...)
 *
 * If cond is truthy, returns all arguments. Otherwise raises an
 * error with msg (default "assertion failed!").
 */
export function luaAssert(cond, msg, ...rest) {
  if (luaTruthy(cond)) {
    return [cond, msg, ...rest];
  }
  const errMsg = msg === undefined ? 'assertion failed!' : msg;
  throw new VMError(errMsg);
}

/**
 * pcall(fn, ...)
 *
 * Calls fn with the given arguments in protected mode. Returns
 * (true, ...) on success, (false, err) on error.
 *
 * The closure invocation is delegated to the VM context because
 * Lua closures cannot be called from JS directly.
 */
export function luaPcall(context, fn, ...args) {
  if (!context || typeof context.callAny !== 'function') {
    // Fallback: only JS functions can be called
    try {
      const result = callJsOrThrow(fn, args);
      return [true, ...normalizeResults(result)];
    } catch (e) {
      return [false, extractErrorValue(e)];
    }
  }

  try {
    const result = context.callAny(fn, args);
    return [true, ...normalizeResults(result)];
  } catch (e) {
    if (e instanceof VMHalt) throw e;
    return [false, extractErrorValue(e)];
  }
}

/**
 * xpcall(fn, handler [, ...])
 *
 * Like pcall but uses `handler` to transform the error value.
 * The handler runs protected too; if it errors, its error replaces
 * the original.
 */
export function luaXpcall(context, fn, handler, ...args) {
  if (!context || typeof context.callAny !== 'function') {
    try {
      const result = callJsOrThrow(fn, args);
      return [true, ...normalizeResults(result)];
    } catch (e) {
      const value = extractErrorValue(e);
      try {
        const handled = callJsOrThrow(handler, [value]);
        return [false, ...normalizeResults(handled)];
      } catch (e2) {
        return [false, extractErrorValue(e2)];
      }
    }
  }

  try {
    const result = context.callAny(fn, args);
    return [true, ...normalizeResults(result)];
  } catch (e) {
    if (e instanceof VMHalt) throw e;
    const value = extractErrorValue(e);
    try {
      const handled = context.callAny(handler, [value]);
      return [false, ...normalizeResults(handled)];
    } catch (e2) {
      return [false, extractErrorValue(e2)];
    }
  }
}

function callJsOrThrow(fn, args) {
  if (typeof fn === 'function') return fn(...args);
  if (fn && fn.__isClosure) {
    throw new Error('cannot call a Lua closure without VM context');
  }
  throw new VMError('attempt to call a ' + luaTypeName(fn) + ' value');
}

function normalizeResults(result) {
  if (result === undefined) return [];
  if (Array.isArray(result)) return result;
  return [result];
}

function extractErrorValue(e) {
  if (e instanceof VMError) return e.value;
  if (e instanceof VMHalt) return 'halt: ' + e.code;
  return e && e.message ? e.message : String(e);
}

// ============================================================
// Traceback
// ============================================================

/**
 * debug.traceback([msg [, level]])
 *
 * Returns a string with the call stack at the time of the call.
 * Our VM provides frame information via the context; if not
 * available, we return the message alone.
 */
export function luaTraceback(context, msg, level) {
  const prefix = msg !== undefined && msg !== null ? luaToString(msg) + '\n' : '';
  if (!context || typeof context.getStackTrace !== 'function') {
    return prefix + 'stack traceback:\n\t<no frames>'; 
  }

  const frames = context.getStackTrace();
  const lines = ['stack traceback:'];
  for (const f of frames) {
    const src = f.source || '[C]';
    const line = f.currentline || f.linedefined || 0;
    const name = f.name || f.namewhat || '';
    lines.push('\t' + src + ':' + line + ': in ' + (name ? name + ' ' : '') + 'function <' + (f.short_src || '?') + '>');
  }
  return prefix + lines.join('\n');
}

// ============================================================
// Error message formatting
// ============================================================

/**
 * Format an error value for display. Lua's default handler prepends
 * the source position for string errors; we skip that step in favor
 * of a cleaner message.
 */
export function formatErrorValue(value) {
  if (value === null || value === undefined) return 'nil error';
  if (typeof value === 'string') return value;
  if (typeof value === 'number') return luaToString(value);
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') {
    // Table error: try __tostring
    return luaToString(value);
  }
  return String(value);
}

/**
 * Wrap a JS error into a VMError with a proper Lua value.
 */
export function wrapError(e) {
  if (e instanceof VMError) return e;
  if (e instanceof VMHalt) return e;
  const value = e && e.message ? e.message : String(e);
  return new VMError(value, { internal: true });
}

// ============================================================
// Protected call context
// ============================================================

/**
 * A "protected region" is a pcall boundary. When the VM hits an
 * error, it unwinds frames until it finds a protected region. The
 * protected region then resumes with the error value.
 *
 * We track protected regions as a stack in the VM. Each entry
 * records:
 *   - the frame depth at entry
 *   - the register/return base for the pcall result
 *   - the handler (for xpcall)
 */
export class ProtectedRegion {
  constructor(options) {
    this.frameDepth = options.frameDepth;
    this.returnBase = options.returnBase;
    this.nresults = options.nresults;
    this.handler = options.handler || null;
    this.isXpcall = !!options.isXpcall;
  }
}

export function pushProtectedRegion(vm, region) {
  if (!vm.protectedStack) vm.protectedStack = [];
  vm.protectedStack.push(region);
}

export function popProtectedRegion(vm) {
  if (!vm.protectedStack) return null;
  return vm.protectedStack.pop() || null;
}

export function currentProtectedRegion(vm) {
  if (!vm.protectedStack || vm.protectedStack.length === 0) return null;
  return vm.protectedStack[vm.protectedStack.length - 1];
}

// ============================================================
// Library object
// ============================================================

export function makeErrorLibrary(context) {
  return {
    error: luaError,
    assert: luaAssert,
    pcall: (...args) => luaPcall(context, ...args),
    xpcall: (...args) => luaXpcall(context, ...args),
  };
}

export default {
  VMError,
  VMHalt,
  luaError,
  luaAssert,
  luaPcall,
  luaXpcall,
  luaTraceback,
  formatErrorValue,
  wrapError,
  ProtectedRegion,
  pushProtectedRegion,
  popProtectedRegion,
  currentProtectedRegion,
  makeErrorLibrary,
};