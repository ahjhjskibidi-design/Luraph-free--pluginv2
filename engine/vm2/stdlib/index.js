/**
 * Standard library registration.
 *
 * Builds the entire standard environment for a VM: every global
 * function from base, and every library namespace (string, table,
 * math, os, io, coroutine, debug, package, bit32, utf8).
 *
 * The VM calls `installStdlib(host, options)` once at construction
 * and receives the fully populated globals table. Individual
 * libraries can be disabled or replaced via `options.libraries`.
 *
 * The registration order matters slightly: base comes first so that
 * libraries can reference its functions (e.g. `tostring`), then the
 * namespaces are added one by one so that any cross-library helper
 * (e.g. math.randomseed using string) sees a complete environment.
 */

import { makeBaseLibrary } from './base.js';
import {
  makeTableLibrary,
  makeMathLibrary,
  makeMetatableLibrary,
  makeErrorLibrary,
  makeDebugLibrary,
  makeBit32Library,
  makeUtf8Library,
  makeIOLibrary,
  makePackageLibrary,
  CoroutineRegistry,
  coroutineCreate,
  coroutineStatus,
  coroutineRunning,
  coroutineIsYieldable,
  coroutineYield,
  coroutineResume,
  coroutineWrap,
  coroutineClose,
} from '../runtime/index.js';

// ============================================================
// Coroutine library
// ============================================================

/**
 * The coroutine library is special because it needs a registry
 * (which tracks the running coroutine) and a reference to the VM for
 * resuming. We build it here so it can be installed as a normal
 * namespace.
 */
function makeCoroutineLibrary(host, registry) {
  return {
    create: coroutineCreate,
    resume: (co, ...args) => coroutineResume(registry, co, ...args),
    yield: (...vals) => coroutineYield(registry, ...vals),
    status: coroutineStatus,
    running: () => coroutineRunning(registry),
    isyieldable: () => coroutineIsYieldable(registry),
    wrap: (fn) => coroutineWrap(registry, fn),
    close: (co) => coroutineClose(registry, co),
  };
}

// ============================================================
// String library wrapper
// ============================================================

/**
 * Lua's string library is a table, but strings also have a metatable
 * with __index pointing to that table. This lets `("foo"):upper()`
 * and `string.upper("foo")` both work.
 *
 * The string library table itself was already built in runtime/string.js
 * as a set of named functions; here we assemble them into a single
 * object with the right keys.
 */
import {
  stringLen,
  stringSub,
  stringByte,
  stringChar,
  stringRep,
  stringLower,
  stringUpper,
  stringReverse,
  stringFormat,
  stringFind,
  stringMatch,
  stringGmatch,
  stringGsub,
  stringDump,
} from '../runtime/string.js';

function makeStringLibrary() {
  return {
    len: stringLen,
    sub: stringSub,
    byte: stringByte,
    char: stringChar,
    rep: stringRep,
    lower: stringLower,
    upper: stringUpper,
    reverse: stringReverse,
    format: stringFormat,
    find: stringFind,
    match: stringMatch,
    gmatch: stringGmatch,
    gsub: stringGsub,
    dump: stringDump,
  };
}

// ============================================================
// Installer
// ============================================================

/**
 * Build the complete global environment.
 *
 * @param {object} host — the VM host interface (see base.js)
 * @param {object} options
 *   options.libraries    — override set: { string: false, io: false, ... }
 *   options.globals      — the globals table (defaults to {})
 *   options.registry     — the registry table (defaults to {})
 * @returns {object} — the globals table, fully populated
 */
export function installStdlib(host, options) {
  options = options || {};
  const disable = options.libraries || {};
  const globals = options.globals || {};
  const registry = options.registry || {};
  const coroutineRegistry = new CoroutineRegistry();

  // ---- Base ----
  if (disable.base !== false) {
    const base = makeBaseLibrary(host, { globals });
    for (const [k, v] of Object.entries(base)) {
      globals[k] = v;
    }
  }

  // ---- String ----
  if (disable.string !== false) {
    const strLib = makeStringLibrary();
    globals.string = strLib;
    // Attach as metatable to the shared string type
    const mt = { __index: strLib };
    registry.stringMetatable = mt;
  }

  // ---- Table ----
  if (disable.table !== false) {
    globals.table = makeTableLibrary();
  }

  // ---- Math ----
  if (disable.math !== false) {
    globals.math = makeMathLibrary();
  }

  // ---- Coroutine ----
  if (disable.coroutine !== false) {
    globals.coroutine = makeCoroutineLibrary(host, coroutineRegistry);
  }

  // ---- Debug ----
  if (disable.debug !== false) {
    globals.debug = makeDebugLibrary();
  }

  // ---- bit32 ----
  if (disable.bit32 !== false) {
    globals.bit32 = makeBit32Library();
  }

  // ---- utf8 ----
  if (disable.utf8 !== false) {
    globals.utf8 = makeUtf8Library();
  }

  // ---- OS ----
  if (disable.os !== false) {
    globals.os = {
      time: (...args) => (require('../runtime/os.js')).osTime(...args),
      clock: () => (require('../runtime/os.js')).osClock(),
      date: (...args) => (require('../runtime/os.js')).osDate(...args),
      difftime: (...args) => (require('../runtime/os.js')).osDifftime(...args),
      getenv: (...args) => (require('../runtime/os.js')).osGetenv(...args),
      exit: (...args) => (require('../runtime/os.js')).osExit(...args),
      tmpname: () => (require('../runtime/os.js')).osTmpname(),
      remove: (...args) => (require('../runtime/os.js')).osRemove(...args),
      rename: (...args) => (require('../runtime/os.js')).osRename(...args),
      execute: (...args) => (require('../runtime/os.js')).osExecute(...args),
      setlocale: (...args) => (require('../runtime/os.js')).osSetlocale(...args),
    };
  }

  // ---- IO ----
  if (disable.io !== false) {
    const ioHost = {
      writeHook: (text) => host && host.write ? host.write(text) : null,
      readHook: () => null,
    };
    globals.io = makeIOLibrary(ioHost);
  }

  // ---- Package ----
  if (disable.package !== false) {
    globals.package = makePackageLibrary({
      globals,
      loaded: {},
      preload: {},
      loaders: [],
    });
    // package.require is the canonical require
    globals.require = globals.package.require;
  }

  // ---- Registry ----
  registry.coroutineRegistry = coroutineRegistry;
  registry.globals = globals;

  return globals;
}

// ============================================================
// Partial installers (for building custom environments)
// ============================================================

export function installBase(host, globals) {
  const base = makeBaseLibrary(host, { globals });
  Object.assign(globals, base);
  return globals;
}

export function installString(globals) {
  globals.string = makeStringLibrary();
  return globals;
}

export function installTable(globals) {
  globals.table = makeTableLibrary();
  return globals;
}

export function installMath(globals) {
  globals.math = makeMathLibrary();
  return globals;
}

export function installMetatable(globals) {
  Object.assign(globals, makeMetatableLibrary());
  return globals;
}

export function installError(host, globals) {
  Object.assign(globals, makeErrorLibrary(host));
  return globals;
}

export function installDebug(globals) {
  globals.debug = makeDebugLibrary();
  return globals;
}

export function installBit32(globals) {
  globals.bit32 = makeBit32Library();
  return globals;
}

export function installUtf8(globals) {
  globals.utf8 = makeUtf8Library();
  return globals;
}

export default {
  installStdlib,
  installBase,
  installString,
  installTable,
  installMath,
  installMetatable,
  installError,
  installDebug,
  installBit32,
  installUtf8,
};