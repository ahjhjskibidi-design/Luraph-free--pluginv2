/**
 * Coroutine runtime — full Lua coroutine support.
 *
 * Lua coroutines are symmetric, cooperative threads. A coroutine
 * starts suspended, runs when resumed, suspends when it yields, and
 * finishes when its body returns.
 *
 * The API:
 *   coroutine.create(fn)         — create a suspended coroutine
 *   coroutine.resume(co, ...)    — resume, returns (ok, ...)
 *   coroutine.yield(...)         — suspend, returns resume's args
 *   coroutine.status(co)         — "suspended" | "running" | "normal" | "dead"
 *   coroutine.running()          — the running coroutine, or nil in main
 *   coroutine.wrap(fn)           — create + return a resume-only function
 *   coroutine.isyieldable()      — true unless in main thread (Lua 5.3+)
 *   coroutine.close(co)          — close a suspended coroutine (Lua 5.4)
 *
 * Implementation:
 *   Each coroutine has its own stack of frames. When a coroutine
 *   yields, we save the entire stack and return control to the
 *   resumer. When resumed, we restore the stack and continue
 *   execution from where it left off.
 *
 *   The current coroutine is tracked in the VM. The main "thread" is
 *   a special coroutine with no name; calling coroutine.running from
 *   the main thread returns nil, and coroutine.yield from the main
 *   thread raises an error.
 *
 * Since JavaScript is single-threaded and has no true continuations,
 * we simulate coroutines by making the VM dispatch loop re-entrant
 * and by keeping coroutine frames fully separate from the main
 * stack. A yield unwinds the coroutine's frame stack; a resume
 * pushes it back.
 */

import { luaToString, luaTypeName, luaTruthy } from './type.js';
import { VMError } from './error.js';

// ============================================================
// Coroutine state
// ============================================================

export const STATUS = {
  SUSPENDED: 'suspended',
  RUNNING: 'running',
  NORMAL: 'normal',
  DEAD: 'dead',
};

/**
 * Coroutine object. This is the value the user sees. The VM fills in
 * the fn and stack. Frames are stored as an array; the coroutine
 * resumes by replaying the top frame.
 */
export class Coroutine {
  constructor(fn, options) {
    options = options || {};
    this.__isCoroutine = true;
    this.fn = fn;
    this.status = STATUS.SUSPENDED;
    this.frames = [];
    this.resumeArgs = [];
    this.yieldValues = null;
    this.errorValue = null;
    this.isMain = !!options.isMain;
    this.started = false;
    this.finished = false;
    this.name = options.name || null;
    this.id = Coroutine.nextId++;
  }

  toString() {
    return 'thread: 0x' + this.id.toString(16);
  }

  static nextId = 1;
}

// ============================================================
// Coroutine registry
// ============================================================

export class CoroutineRegistry {
  constructor() {
    this.running = null;
    this.stack = [];
  }

  getCurrent() {
    return this.running;
  }

  pushRunning(co) {
    if (this.running) this.running.status = STATUS.NORMAL;
    this.stack.push(this.running);
    this.running = co;
    co.status = STATUS.RUNNING;
  }

  popRunning() {
    const co = this.running;
    this.running = this.stack.pop() || null;
    if (this.running) this.running.status = STATUS.RUNNING;
    return co;
  }
}

// ============================================================
// Library operations
// ============================================================

/**
 * coroutine.create(fn)
 *
 * Creates a suspended coroutine with body fn. fn must be callable.
 */
export function coroutineCreate(fn) {
  if (!fn || (typeof fn !== 'function' && !fn.__isClosure)) {
    throw new Error('bad argument #1 to coroutine.create (function expected)');
  }
  return new Coroutine(fn);
}

/**
 * coroutine.status(co)
 */
export function coroutineStatus(co) {
  if (!co || !co.__isCoroutine) {
    throw new Error('bad argument #1 to coroutine.status (coroutine expected)');
  }
  if (co.isMain) {
    return co.status === STATUS.RUNNING ? 'running' : 'normal';
  }
  return co.status;
}

/**
 * coroutine.running()
 *
 * Returns the running coroutine, or nil if called from the main
 * thread. In Lua 5.2+ this returns (co, ismain).
 */
export function coroutineRunning(registry) {
  if (!registry || !registry.running) return null;
  if (registry.running.isMain) return null;
  return registry.running;
}

/**
 * coroutine.isyieldable()
 *
 * True if the running coroutine can yield. Always false in the main
 * thread.
 */
export function coroutineIsYieldable(registry) {
  if (!registry || !registry.running) return false;
  return !registry.running.isMain;
}

/**
 * coroutine.yield(...)
 *
 * Suspends the running coroutine. The values yielded are the return
 * values of resume. When the coroutine is resumed, resume's arguments
 * become yield's return values.
 *
 * This function is implemented as a throw of a special marker. The
 * VM catches the marker at the resume boundary and returns the
 * yielded values to the resumer.
 */
export class YieldSignal extends Error {
  constructor(values) {
    super('coroutine yield');
    this.name = 'YieldSignal';
    this.values = values;
  }
}

export function coroutineYield(registry, ...values) {
  if (!registry || !registry.running || registry.running.isMain) {
    throw new VMError('attempt to yield from outside a coroutine');
  }
  throw new YieldSignal(values);
}

/**
 * coroutine.resume(co, ...)
 *
 * Resumes co with the given arguments. Returns (true, ...) if the
 * coroutine yields or finishes, (false, err) if it errors.
 *
 * The actual switching is done by the VM because JS has no
 * continuations. This function validates the arguments and delegates
 * to the runtime's `resumeCoroutine` hook.
 */
export function coroutineResume(registry, co, ...args) {
  if (!co || !co.__isCoroutine) {
    throw new Error('bad argument #1 to coroutine.resume (coroutine expected)');
  }

  if (co.status === STATUS.DEAD) {
    return [false, 'cannot resume dead coroutine'];
  }

  if (co.status === STATUS.RUNNING || co.status === STATUS.NORMAL) {
    return [false, 'cannot resume non-suspended coroutine'];
  }

  if (!registry || typeof registry.resumeImpl !== 'function') {
    return [false, 'coroutine.resume requires VM runtime'];
  }

  try {
    const values = registry.resumeImpl(co, args);
    return [true, ...values];
  } catch (e) {
    if (e instanceof VMError) {
      return [false, e.value];
    }
    if (e instanceof YieldSignal) {
      return [true, ...e.values];
    }
    return [false, e.message || String(e)];
  }
}

/**
 * coroutine.wrap(fn)
 *
 * Creates a coroutine and returns a function that resumes it. Errors
 * raised inside the coroutine are re-raised in the caller.
 */
export function coroutineWrap(registry, fn) {
  const co = coroutineCreate(fn);
  return function (...args) {
    const [ok, ...rest] = coroutineResume(registry, co, ...args);
    if (!ok) {
      throw new VMError(rest[0]);
    }
    return rest;
  };
}

/**
 * coroutine.close(co)
 *
 * Lua 5.4 feature. Closes a suspended or dead coroutine, running any
 * to-be-closed variables. Our implementation marks the coroutine as
 * dead and clears its frames.
 */
export function coroutineClose(registry, co) {
  if (!co || !co.__isCoroutine) {
    throw new Error('bad argument #1 to coroutine.close (coroutine expected)');
  }
  if (co.status === STATUS.RUNNING || co.status === STATUS.NORMAL) {
    throw new VMError('cannot close a running coroutine');
  }
  co.status = STATUS.DEAD;
  co.frames = [];
  co.finished = true;
  return true;
}

// ============================================================
// Coroutine-aware frame management
// ============================================================

/**
 * When a coroutine is resumed, its frames are pushed onto the VM's
 * execution stack. When it yields, the frames are moved off the
 * stack and stored in the coroutine object.
 *
 * This helper records the split point so the VM can put the frames
 * back exactly where they were.
 */
export class CoroutineContext {
  constructor(coroutine, baseFrameDepth) {
    this.coroutine = coroutine;
    this.baseFrameDepth = baseFrameDepth;
    this.savedFrames = null;
  }

  suspend(vm) {
    // Move all frames above the base depth into the coroutine object
    const frames = vm.stack.frames;
    this.savedFrames = frames.slice(this.baseFrameDepth);
    frames.length = this.baseFrameDepth;
    this.coroutine.frames = this.savedFrames;
  }

  restore(vm) {
    const frames = vm.stack.frames;
    for (const f of this.savedFrames) {
      frames.push(f);
    }
  }
}

export default {
  STATUS,
  Coroutine,
  CoroutineRegistry,
  coroutineCreate,
  coroutineStatus,
  coroutineRunning,
  coroutineIsYieldable,
  YieldSignal,
  coroutineYield,
  coroutineResume,
  coroutineWrap,
  coroutineClose,
  CoroutineContext,
};