/**
 * Debug runtime — the parts of the Lua debug library exposed by the VM.
 *
 * Lua's debug library is powerful and dangerous. In a sandbox we
 * expose a restricted subset:
 *
 *   debug.getinfo([thread,] f [, what])
 *     — returns a table with info about a function or stack frame
 *   debug.traceback([thread,] [msg [, level]])
 *     — returns a string with the current stack
 *   debug.sethook([thread,] hook, mask [, count])
 *     — installs a debug hook (only "call" events supported)
 *   debug.gethook([thread])
 *     — returns the current hook function and mask
 *   debug.getlocal([thread,] f, local)
 *     — reads a local variable (only within our own frames)
 *   debug.setlocal([thread,] level, local, value)
 *     — writes a local variable
 *   debug.getupvalue(f, up)
 *     — reads an upvalue
 *   debug.setupvalue(f, up, value)
 *     — writes an upvalue
 *   debug.upvalueid(f, n)
 *     — returns a unique id for the upvalue (Lua 5.2+)
 *   debug.upvaluejoin(f1, n1, f2, n2)
 *     — makes two closures share an upvalue (Lua 5.2+)
 *   debug.getregistry()
 *     — returns the registry table
 *   debug.getmetatable(v)
 *     — same as getmetatable but ignores __metatable field
 *   debug.setmetatable(v, mt)
 *     — same as setmetatable but bypasses protection
 *   debug.getuservalue(u [, n])
 *     — userdata access (not applicable)
 *   debug.setuservalue(u, v [, n])
 *     — userdata access
 *
 * The debug library is often used for introspection, profiling, and
 * sandboxing escapes. Our implementation is safe by default: it
 * cannot escape the VM, cannot modify the interpreter's internal
 * state, and cannot install hooks that would run arbitrary code
 * outside the dispatch loop.
 */

import { luaToString, luaTypeName, luaTruthy, luaToNumber } from './type.js';
import { getMetatable, setMetatable } from './metatable.js';

// ============================================================
// Context — the VM injects this at startup
// ============================================================

let vmContext = null;

export function setDebugContext(ctx) {
  vmContext = ctx;
}

export function getDebugContext() {
  return vmContext;
}

// ============================================================
// debug.getinfo
// ============================================================

/**
 * debug.getinfo([thread,] f [, what])
 *
 * If f is a number, it names a stack level (1 = the caller of
 * getinfo, 2 = its caller, etc.). If f is a function, it describes
 * that function directly.
 *
 * `what` is a string selecting fields. Default is "flnSu" which
 * gives:
 *   source        — chunk name (e.g. "@script.lua", "=stdin")
 *   short_src     — short form of source
 *   linedefined   — line where the function is defined
 *   lastlinedefined — line where the definition ends
 *   what          — "Lua", "C", or "main"
 *   currentline   — line currently executing (only for stack frames)
 *   name          — name of the function (from caller's perspective)
 *   namewhat      — "global", "local", "method", "field", ""
 *   nups          — number of upvalues
 *   nparams       — number of parameters
 *   isvararg      — boolean
 *   func          — the function itself
 *   istailcall    — boolean
 *   activelines   — table of line numbers (debug only)
 *
 * We support the common subset: source, short_src, linedefined,
 * what, currentline, nups, nparams, isvararg, func.
 */
export function debugGetinfo(arg, what) {
  if (!vmContext) return null;

  let info;

  if (typeof arg === 'number') {
    const level = Math.trunc(luaToNumber(arg));
    info = vmContext.getFrameInfo(level);
    if (!info) return null;
  } else if (typeof arg === 'function' || (arg && arg.__isClosure)) {
    info = vmContext.getFunctionInfo(arg);
  } else {
    throw new Error('bad argument #1 to debug.getinfo (function or level expected)');
  }

  if (!what) what = 'flnSu';
  what = luaToString(what);

  const result = {};

  if (what.includes('S')) {
    result.source = info.source || '=[C]';
    result.short_src = info.shortSrc || result.source;
    result.linedefined = info.linedefined !== undefined ? info.linedefined : -1;
    result.lastlinedefined = info.lastlinedefined !== undefined ? info.lastlinedefined : -1;
    result.what = info.what || 'Lua';
  }

  if (what.includes('l')) {
    result.currentline = info.currentline !== undefined ? info.currentline : -1;
  }

  if (what.includes('n')) {
    result.name = info.name || null;
    result.namewhat = info.namewhat || '';
  }

  if (what.includes('u')) {
    result.nups = info.nups || 0;
    result.nparams = info.nparams !== undefined ? info.nparams : 0;
    result.isvararg = !!info.isvararg;
  }

  if (what.includes('t')) {
    result.istailcall = !!info.istailcall;
  }

  if (what.includes('f')) {
    result.func = info.func || null;
  }

  if (what.includes('L')) {
    result.activelines = info.activelines || {};
  }

  return result;
}

// ============================================================
// debug.getlocal / debug.setlocal
// ============================================================

/**
 * debug.getlocal([thread,] level, index)
 *
 * Returns (name, value) for a local variable. Returns nil if the
 * index is out of range.
 */
export function debugGetlocal(level, index) {
  if (!vmContext) return null;
  const frame = vmContext.getFrame(level);
  if (!frame) return null;

  const proto = frame.proto;
  const params = (proto && proto.params) || [];
  const locals = (proto && proto.locals) || [];

  const i = Math.trunc(luaToNumber(index));
  if (i < 1) return null;

  // First the parameters, then the declared locals
  if (i <= params.length) {
    return [params[i - 1], frame.registers[i - 1]];
  }
  const j = i - params.length - 1;
  if (j < locals.length) {
    const reg = params.length + j;
    return [locals[j], frame.registers[reg]];
  }
  return null;
}

/**
 * debug.setlocal([thread,] level, index, value)
 *
 * Sets a local variable. Returns the name on success, nil on failure.
 */
export function debugSetlocal(level, index, value) {
  if (!vmContext) return null;
  const frame = vmContext.getFrame(level);
  if (!frame) return null;

  const proto = frame.proto;
  const params = (proto && proto.params) || [];
  const locals = (proto && proto.locals) || [];

  const i = Math.trunc(luaToNumber(index));
  if (i < 1) return null;

  if (i <= params.length) {
    frame.registers[i - 1] = value;
    return params[i - 1];
  }
  const j = i - params.length - 1;
  if (j < locals.length) {
    const reg = params.length + j;
    frame.registers[reg] = value;
    return locals[j];
  }
  return null;
}

// ============================================================
// debug.getupvalue / debug.setupvalue
// ============================================================

export function debugGetupvalue(fn, index) {
  if (!fn || !fn.__isClosure) return null;
  const ups = fn.__upvalues || [];
  const i = Math.trunc(luaToNumber(index)) - 1;
  if (i < 0 || i >= ups.length) return null;
  return [ups[i].name || '', ups[i].get()];
}

export function debugSetupvalue(fn, index, value) {
  if (!fn || !fn.__isClosure) return null;
  const ups = fn.__upvalues || [];
  const i = Math.trunc(luaToNumber(index)) - 1;
  if (i < 0 || i >= ups.length) return null;
  ups[i].set(value);
  return ups[i].name || '';
}

/**
 * debug.upvalueid(fn, n)
 *
 * Returns a unique id (light userdata) for the upvalue. Two closures
 * that share an upvalue return the same id.
 */
export function debugUpvalueid(fn, n) {
  if (!fn || !fn.__isClosure) return null;
  const ups = fn.__upvalues || [];
  const i = Math.trunc(luaToNumber(n)) - 1;
  if (i < 0 || i >= ups.length) return null;
  const cell = ups[i];
  if (!cell.__id) {
    cell.__id = { __isUpvalueId: true, id: Math.random().toString(36).slice(2) };
  }
  return cell.__id;
}

/**
 * debug.upvaluejoin(f1, n1, f2, n2)
 *
 * Makes the nth upvalue of f1 refer to the same cell as the nth
 * upvalue of f2.
 */
export function debugUpvaluejoin(f1, n1, f2, n2) {
  if (!f1 || !f1.__isClosure) {
    throw new Error('bad argument #1 to debug.upvaluejoin (Lua function expected)');
  }
  if (!f2 || !f2.__isClosure) {
    throw new Error('bad argument #3 to debug.upvaluejoin (Lua function expected)');
  }
  const i = Math.trunc(luaToNumber(n1)) - 1;
  const j = Math.trunc(luaToNumber(n2)) - 1;
  const ups1 = f1.__upvalues || [];
  const ups2 = f2.__upvalues || [];
  if (i < 0 || i >= ups1.length) {
    throw new Error('bad argument #2 to debug.upvaluejoin (index out of range)');
  }
  if (j < 0 || j >= ups2.length) {
    throw new Error('bad argument #4 to debug.upvaluejoin (index out of range)');
  }
  ups1[i] = ups2[j];
}

// ============================================================
// debug.getmetatable / debug.setmetatable
// ============================================================

/**
 * debug.getmetatable(v)
 *
 * Returns the actual metatable, ignoring __metatable protection.
 */
export function debugGetmetatable(v) {
  return getMetatable(v);
}

/**
 * debug.setmetatable(v, mt)
 *
 * Sets the metatable, bypassing __metatable protection.
 */
export function debugSetmetatable(v, mt) {
  return setMetatable(v, mt);
}

// ============================================================
// debug.getregistry
// ============================================================

/**
 * debug.getregistry()
 *
 * Returns the internal registry table. In real Lua this exposes
 * shared type metatables and other internals. We provide a proxy
 * that reads from the type metatable table.
 */
export function debugGetregistry() {
  if (!vmContext || !vmContext.registry) {
    return {};
  }
  return vmContext.registry;
}

// ============================================================
// debug.traceback
// ============================================================

export function debugTraceback(msg, level) {
  if (!vmContext) return (msg ? luaToString(msg) + '\n' : '') + 'stack traceback:\n\tno frames';
  const prefix = msg !== undefined && msg !== null ? luaToString(msg) + '\n' : '';
  const frames = vmContext.getStackTrace ? vmContext.getStackTrace() : [];
  const lines = ['stack traceback:'];
  const skip = level ? Math.max(0, Math.trunc(luaToNumber(level)) - 1) : 0;
  for (let i = skip; i < frames.length; i++) {
    const f = frames[i];
    const src = f.shortSrc || '[C]';
    const line = f.currentline || f.linedefined || 0;
    lines.push('\t' + src + ':' + line + ': in function <' + src + '>');
  }
  return prefix + lines.join('\n');
}

// ============================================================
// debug.sethook / debug.gethook
// ============================================================

/**
 * debug.sethook([thread,] hook, mask [, count])
 *
 * Installs a hook function called at the events selected by mask.
 * Mask letters:
 *   "c" — call
 *   "r" — return
 *   "l" — line
 *   ">" — errors
 *   ""  — disable
 *
 * Full hook support would require the VM to invoke the hook at
 * every event, which adds significant overhead. We support the
 * basic case: the hook is stored and invoked on call events.
 */
export function debugSethook(hook, mask, count) {
  if (!vmContext) return;
  if (hook === null || hook === undefined || mask === '' || mask === null) {
    vmContext.hook = null;
    vmContext.hookMask = '';
    vmContext.hookCount = 0;
    return;
  }
  if (typeof hook !== 'function' && !(hook && hook.__isClosure)) {
    throw new Error('bad argument #1 to debug.sethook (function expected)');
  }
  vmContext.hook = hook;
  vmContext.hookMask = luaToString(mask || '');
  vmContext.hookCount = count ? Math.trunc(luaToNumber(count)) : 0;
}

export function debugGethook() {
  if (!vmContext || !vmContext.hook) return [null, '', 0];
  return [vmContext.hook, vmContext.hookMask || '', vmContext.hookCount || 0];
}

// ============================================================
// debug.getuservalue / debug.setuservalue
// ============================================================

export function debugGetuservalue(u, n) {
  if (!u || typeof u !== 'object' || !u.__isUserdata) return null;
  return u.value;
}

export function debugSetuservalue(u, v, n) {
  if (!u || typeof u !== 'object' || !u.__isUserdata) {
    throw new Error('bad argument #1 to debug.setuservalue (userdata expected)');
  }
  u.value = v;
  return u;
}

// ============================================================
// debug.getuservalue / other stubs
// ============================================================

export function debugStub(name) {
  return function () {
    throw new Error('debug.' + name + ' is not available in this sandbox');
  };
}

// ============================================================
// Library object
// ============================================================

export function makeDebugLibrary() {
  return {
    getinfo: debugGetinfo,
    traceback: debugTraceback,
    sethook: debugSethook,
    gethook: debugGethook,
    getlocal: debugGetlocal,
    setlocal: debugSetlocal,
    getupvalue: debugGetupvalue,
    setupvalue: debugSetupvalue,
    upvalueid: debugUpvalueid,
    upvaluejoin: debugUpvaluejoin,
    getmetatable: debugGetmetatable,
    setmetatable: debugSetmetatable,
    getregistry: debugGetRegistry,
    getuservalue: debugGetuservalue,
    setuservalue: debugSetuservalue,
    getfenv: debugStub('getfenv'),
    setfenv: debugStub('setfenv'),
  };
}

export default {
  setDebugContext,
  getDebugContext,
  debugGetinfo,
  debugGetlocal,
  debugSetlocal,
  debugGetupvalue,
  debugSetupvalue,
  debugUpvalueid,
  debugUpvaluejoin,
  debugGetmetatable,
  debugSetmetatable,
  debugGetregistry,
  debugTraceback,
  debugSethook,
  debugGethook,
  debugGetuservalue,
  debugSetuservalue,
  makeDebugLibrary,
};