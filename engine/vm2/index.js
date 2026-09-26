/**
 * VM2 — main interpreter.
 *
 * Loads a compiled program (from engine/compiler), builds a global
 * environment via stdlib, and executes bytecode.
 *
 * Usage:
 *   import { VM2 } from './engine/vm2/index.js';
 *   const vm = new VM2(program, { io: { print: console.log } });
 *   vm.run();
 *
 * Program shape (from compiler):
 *   {
 *     version: 1,
 *     constants: [ { type, value } ],
 *     protos: [ Proto ],
 *     main: Proto
 *   }
 *
 * Proto shape:
 *   {
 *     instructions: [Uint32],
 *     params: [string],
 *     isVararg: boolean,
 *     upvalues: [ { name, fromParentLocal?, fromParentUpvalue? } ],
 *     registerCount: number,
 *     locals: [string]     (optional, for debug.getlocal)
 *   }
 */

import { OP, OP_NAME } from './opcodes.js';
import { decode, decodeJump, rkValue, rkIsConst, rkIndex } from './decode.js';
import { Frame, Stack } from './stack.js';
import { UpvalueCell } from './upvalue.js';

import {
  luaTypeName, luaTruthy, luaToString, luaToNumber, luaEquals, luaLess,
  luaAdd, luaSub, luaMul, luaDiv, luaIDiv, luaMod, luaPow, luaUnm,
  luaBand, luaBor, luaBxor, luaBnot, luaShl, luaShr,
  luaEq, luaNe, luaLt, luaLe, luaGt, luaGe,
  tableGet, tableSet, tableRawGet, tableRawSet, tableEquals,
  rawLength, tableLength,
  luaConcat, luaLen,
  getMetatable, setMetatable, lookupMetamethod,
  tryBinaryMetamethod, tryUnaryMetamethod, callMetamethod,
  setMetamethodContext,
  VMError, VMHalt,
  YieldSignal,
  Coroutine, STATUS,
  CoroutineRegistry,
  setDebugContext,
  installStdlib,
} from './runtime/index.js';

import { installStdlib as installStdlibFull } from './stdlib/index.js';

// ============================================================
// Constants loader
// ============================================================

function loadConstants(entries) {
  const out = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    switch (e.type) {
      case 0: out[i] = null; break;
      case 1: out[i] = e.value; break;
      case 2: out[i] = e.value; break;
      case 3: out[i] = e.value; break;
      default: out[i] = null;
    }
  }
  return out;
}

// ============================================================
// VM2 class
// ============================================================

export class VM2 {
  constructor(program, options) {
    options = options || {};

    this.program = program;
    this.constants = loadConstants(program.constants);
    this.stack = new Stack();
    this.protectedStack = [];
    this.maxDepth = options.maxDepth || 200;
    this.steps = 0;
    this.maxSteps = options.maxSteps || 10000000;
    this.io = options.io || { print: (s) => console.log(s) };

    // Build host interface for standard library
    const self = this;
    this.host = {
      write: (text) => {
        if (self.io && typeof self.io.print === 'function') self.io.print(text);
        else console.log(text);
      },
      warn: (text) => {
        if (self.io && typeof self.io.warn === 'function') self.io.warn(text);
        else if (self.io && typeof self.io.print === 'function') self.io.print(text);
        else console.warn(text);
      },
      callAny: (fn, args) => self.callAny(fn, args),
      loadString: (src, name) => self.loadString(src, name),
      getGlobals: () => self.globals,
      getRegistry: () => self.registry,
    };

    // Registry
    this.registry = {};

    // Globals — populated by stdlib installer
    this.globals = {};
    const installed = installStdlibFull(this.host, {
      globals: this.globals,
      registry: this.registry,
      libraries: options.libraries || {},
    });

    // Ensure _G references the globals table
    installed._G = installed;

    // Coroutine registry for coroutine library
    this.coroutineRegistry = this.registry.coroutineRegistry || new CoroutineRegistry();

    // Wire metamethod context so `callClosure` works from inside
    // metamethod handlers
    setMetamethodContext({
      callClosure: (fn, args) => this.callAny(fn, args),
      callValue: (v, args) => this.callAny(v, args),
      typeMetatables: {},
      getStackTrace: () => this.getStackTrace(),
    });

    // Wire debug context
    setDebugContext({
      getFrame: (level) => this.getFrameAtLevel(level),
      getFrameInfo: (level) => this.getFrameInfoAtLevel(level),
      getFunctionInfo: (fn) => this.getFunctionInfo(fn),
      getStackTrace: () => this.getStackTrace(),
      registry: this.registry,
      hook: null,
      hookMask: '',
      hookCount: 0,
    });

    // Default main coroutine
    this.mainCoroutine = new Coroutine(null, { isMain: true });
    this.mainCoroutine.status = STATUS.RUNNING;
    this.coroutineRegistry.running = this.mainCoroutine;
  }

  // ============================================================
  // Public API
  // ============================================================

  run() {
    const mainFrame = new Frame(this.program.main, {
      callerFrame: null,
      returnBase: 0,
      nresults: 0,
      varargs: [],
    });
    this.stack.push(mainFrame);
    this.executeUntilDepth(0);
    return mainFrame.returnValues || [];
  }

  /**
   * Call a JS function or Lua closure. Used by pcall, xpcall, and
   * metamethods. Returns the result (single value or array).
   */
  callAny(fn, args) {
    if (typeof fn === 'function') {
      return fn(...args);
    }
    if (fn && fn.__isClosure) {
      return this.invokeClosure(fn, args);
    }
    throw new VMError('attempt to call a ' + luaTypeName(fn) + ' value');
  }

  /**
   * Invoke a closure by pushing a frame and running until it returns.
   * Used for calls from outside the main dispatch loop.
   */
  invokeClosure(closure, args) {
    const proto = closure.__proto;
    if (this.stack.depth() >= this.maxDepth) {
      throw new VMError('stack overflow');
    }

    const params = proto.params || [];
    const varargs = args.length > params.length ? args.slice(params.length) : [];

    const frame = new Frame(proto, {
      callerFrame: null,
      returnBase: 0,
      nresults: -1,
      varargs,
    });
    frame.upvalues = closure.__upvalues || [];

    // Copy fixed arguments into registers
    for (let i = 0; i < params.length; i++) {
      frame.registers[i] = args[i];
    }

    const depthBefore = this.stack.depth();
    this.stack.push(frame);
    this.executeUntilDepth(depthBefore);
    return frame.returnValues || [];
  }

  /**
   * Compile a Lua source string via the host compiler and return a
   * closure. The compiler is injected at construction time via
   * options.compiler. If absent, loadstring is disabled.
   */
  loadString(source, chunkName) {
    if (!this.compiler) {
      throw new VMError('loadstring is not available: no compiler attached');
    }
    const program = this.compiler(source);
    // Build a closure from the main proto
    return {
      __isClosure: true,
      __proto: program.main,
      __upvalues: [],
      __program: program,
    };
  }

  setCompiler(fn) {
    this.compiler = fn;
  }

  // ============================================================
  // Execution
  // ============================================================

  executeUntilDepth(targetDepth) {
    while (this.stack.depth() > targetDepth) {
      const frame = this.stack.top();

      if (frame.pc >= frame.instructions.length) {
        this.doReturn(frame, []);
        continue;
      }

      if (++this.steps > this.maxSteps) {
        throw new VMError('VM step limit exceeded');
      }

      const word = frame.instructions[frame.pc];
      frame.pc++;
      const inst = decode(word);

      try {
        this.dispatch(frame, inst);
      } catch (err) {
        if (err instanceof VMError || err instanceof VMHalt || err instanceof YieldSignal) {
          throw err;
        }
        const opName = OP_NAME[inst.op] || ('0x' + inst.op.toString(16));
        throw new VMError(
          'VM error at pc ' + (frame.pc - 1) + ' (' + opName + '): ' + err.message
        );
      }
    }
  }

  // ============================================================
  // Main dispatcher
  // ============================================================

  dispatch(frame, inst) {
    const op = inst.op;
    const A = inst.a;
    const B = inst.b;
    const C = inst.c;
    const regs = frame.registers;
    const K = this.constants;

    switch (op) {
      case OP.LOADK:
        regs[A] = K[B];
        return;

      case OP.LOADNIL:
        for (let i = 0; i <= C; i++) regs[A + i] = null;
        return;

      case OP.LOADBOOL:
        regs[A] = (B === 1);
        if (C !== 0) frame.pc++;
        return;

      case OP.LOADVARARG: {
        if (B === 0) {
          for (let i = 0; i < frame.varargs.length; i++) {
            regs[A + i] = frame.varargs[i];
          }
          frame.varargTop = A + frame.varargs.length;
        } else {
          for (let i = 0; i < B; i++) regs[A + i] = frame.varargs[i];
        }
        return;
      }

      case OP.MOVE:
        regs[A] = regs[B];
        return;

      case OP.GETGLOBAL: {
        const name = K[B];
        const mt = getMetatable(this.globals);
        if (mt && mt.__index !== undefined) {
          regs[A] = tableGet(this.globals, name);
        } else {
          regs[A] = this.globals[name];
        }
        return;
      }

      case OP.SETGLOBAL: {
        const name = K[B];
        tableSet(this.globals, name, regs[A]);
        return;
      }

      case OP.NEWTABLE:
        regs[A] = {};
        return;

      case OP.GETTABLE: {
        const t = regs[B];
        const k = rkValue(regs, K, C);
        regs[A] = tableGet(t, k);
        return;
      }

      case OP.SETTABLE: {
        const t = regs[A];
        const k = rkValue(regs, K, B);
        const v = rkValue(regs, K, C);
        tableSet(t, k, v);
        return;
      }

      case OP.SETLIST: {
        // Bulk array assignment: R[A][B + i] = R[A + i] for i = 1..C
        const t = regs[A];
        const offset = B;
        const count = C;
        for (let i = 1; i <= count; i++) {
          t[offset + i] = regs[A + i];
        }
        return;
      }

      case OP.ADD:
        regs[A] = luaAdd(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.SUB:
        regs[A] = luaSub(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.MUL:
        regs[A] = luaMul(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.DIV:
        regs[A] = luaDiv(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.MOD:
        regs[A] = luaMod(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.POW:
        regs[A] = luaPow(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.UNM:
        regs[A] = luaUnm(regs[B]);
        return;
      case OP.IDIV:
        regs[A] = luaIDiv(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.BAND:
        regs[A] = luaBand(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.BOR:
        regs[A] = luaBor(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.BXOR:
        regs[A] = luaBxor(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.BNOT:
        regs[A] = luaBnot(regs[B]);
        return;
      case OP.SHL:
        regs[A] = luaShl(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.SHR:
        regs[A] = luaShr(rkValue(regs, K, B), rkValue(regs, K, C));
        return;

      case OP.EQ: {
        const r = luaEq(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.NE: {
        const r = luaNe(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.LT: {
        const r = luaLt(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.LE: {
        const r = luaLe(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.GT: {
        const r = luaGt(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.GE: {
        const r = luaGe(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }

      case OP.NOT:
        regs[A] = !luaTruthy(regs[B]);
        return;

      case OP.LEN:
        regs[A] = luaLen(regs[B]);
        return;

      case OP.CONCAT:
        regs[A] = luaConcat(regs, B, C);
        return;

      case OP.JMP: {
        const sBx = decodeJump(B, C);
        frame.pc += sBx;
        return;
      }

      case OP.TEST: {
        const val = regs[A];
        const want = (B === 1);
        if (luaTruthy(val) === want) frame.pc++;
        return;
      }

      case OP.TESTSET: {
        const val = regs[B];
        const want = (C === 1);
        if (luaTruthy(val) === want) {
          frame.pc++;
        } else {
          regs[A] = val;
        }
        return;
      }

      case OP.CLOSURE:
        this.doClosure(frame, inst);
        return;

      case OP.CALL:
        this.doCall(frame, inst);
        return;

      case OP.TAILCALL:
        this.doTailCall(frame, inst);
        return;

      case OP.RETURN:
        this.doReturnInstruction(frame, inst);
        return;

      case OP.GETUPVAL: {
        const uv = frame.upvalues[B];
        regs[A] = uv ? uv.get() : null;
        return;
      }

      case OP.SETUPVAL: {
        const uv = frame.upvalues[B];
        if (uv) uv.set(regs[A]);
        return;
      }

      case OP.NEWUPVAL: {
        // Create a fresh upvalue cell that points to a register.
        // The register lives in the current frame; when the frame
        // returns, the cell closes (see closeUpvalues).
        const reg = B;
        const cell = new UpvalueCell(reg, frame);
        frame.openUpvalues.push({ register: reg, cell });
        regs[A] = cell;
        return;
      }

      case OP.CLOSEUPVAL: {
        frame.closeUpvalues(A);
        return;
      }

      case OP.SETMETATABLE: {
        const t = regs[A];
        const mt = regs[B];
        try {
          setMetatable(t, mt);
        } catch (e) {
          throw new VMError(e.message);
        }
        return;
      }

      case OP.GETMETATABLE: {
        regs[A] = getMetatable(regs[B]);
        return;
      }

      case OP.HALT:
        this.stack.frames.length = 0;
        return;

      default:
        throw new VMError('unknown opcode 0x' + op.toString(16));
    }
  }

  // ============================================================
  // Instruction handlers
  // ============================================================

  doClosure(frame, inst) {
    const A = inst.a;
    const B = inst.b;
    const regs = frame.registers;
    const proto = this.program.protos[B];

    const upvalues = [];
    for (const up of (proto.upvalues || [])) {
      if (up.fromParentLocal !== undefined) {
        const reg = up.fromParentLocal;
        const parentRegs = frame.registers;
        upvalues.push({
          name: up.name || '',
          get: () => parentRegs[reg],
          set: (v) => { parentRegs[reg] = v; },
        });
      } else if (up.fromParentUpvalue !== undefined) {
        upvalues.push(frame.upvalues[up.fromParentUpvalue]);
      } else {
        upvalues.push({ name: up.name || '', get: () => null, set: () => {} });
      }
    }

    regs[A] = {
      __isClosure: true,
      __proto: proto,
      __upvalues: upvalues,
    };
  }

  doCall(frame, inst) {
    const A = inst.a;
    const B = inst.b;
    const C = inst.c;
    const regs = frame.registers;
    const funcReg = A;
    const nargs = B;
    const nresults = C - 1;
    const func = regs[funcReg];

    const args = [];
    for (let i = 0; i < nargs; i++) args.push(regs[funcReg + 1 + i]);

    if (typeof func === 'function') {
      let results = func(...args);
      if (!Array.isArray(results)) results = [results];
      const count = nresults < 0 ? results.length : nresults;
      for (let i = 0; i < count; i++) regs[funcReg + i] = results[i];
      if (nresults < 0) frame.callResultTop = funcReg + results.length;
      return;
    }

    if (func && func.__isClosure) {
      if (this.stack.depth() >= this.maxDepth) {
        throw new VMError('stack overflow');
      }
      const params = func.__proto.params || [];
      const varargs = args.length > params.length ? args.slice(params.length) : [];
      const newFrame = new Frame(func.__proto, {
        callerFrame: frame,
        returnBase: funcReg,
        nresults,
        varargs,
      });
      newFrame.upvalues = func.__upvalues || [];
      for (let i = 0; i < params.length; i++) newFrame.registers[i] = args[i];
      this.stack.push(newFrame);
      return;
    }

    // Try __call metamethod
    const mt = getMetatable(func);
    if (mt && mt.__call !== undefined) {
      const results = callMetamethod(mt.__call, [func, ...args]);
      const resultList = Array.isArray(results) ? results : [results];
      const count = nresults < 0 ? resultList.length : nresults;
      for (let i = 0; i < count; i++) regs[funcReg + i] = resultList[i];
      if (nresults < 0) frame.callResultTop = funcReg + resultList.length;
      return;
    }

    throw new VMError('attempt to call a ' + luaTypeName(func) + ' value');
  }

  doTailCall(frame, inst) {
    // Tail call: replace the current frame's proto with the callee's,
    // keeping the same caller. This avoids stack growth for tail-
    // recursive functions.
    const A = inst.a;
    const B = inst.b;
    const regs = frame.registers;
    const func = regs[A];
    const nargs = B;

    const args = [];
    for (let i = 0; i < nargs; i++) args.push(regs[A + 1 + i]);

    if (func && func.__isClosure) {
      const proto = func.__proto;
      const params = proto.params || [];
      const varargs = args.length > params.length ? args.slice(params.length) : [];

      // Replace the current frame in place
      frame.proto = proto;
      frame.instructions = proto.instructions;
      frame.registers = new Array((proto.registerCount || 0) + 128);
      frame.pc = 0;
      frame.varargs = varargs;
      frame.upvalues = func.__upvalues || [];
      for (let i = 0; i < params.length; i++) frame.registers[i] = args[i];
      return;
    }

    // Not a closure — fall back to a regular call
    this.doCall(frame, { op: OP.CALL, a: A, b: B, c: 0 });
  }

  doReturnInstruction(frame, inst) {
    const A = inst.a;
    const B = inst.b;
    const regs = frame.registers;
    const base = A;
    const count = B - 1;

    let values;
    if (count < 0) {
      const top = frame.callResultTop !== undefined ? frame.callResultTop : base;
      values = [];
      for (let i = base; i < top; i++) values.push(regs[i]);
    } else {
      values = [];
      for (let i = 0; i < count; i++) values.push(regs[base + i]);
    }

    this.doReturn(frame, values);
  }

  doReturn(frame, values) {
    frame.returnValues = values;
    frame.closeUpvalues(0);
    this.stack.pop();

    const caller = frame.callerFrame;
    if (!caller) return;

    const base = frame.returnBase;
    const wanted = frame.nresults;

    if (wanted < 0) {
      for (let i = 0; i < values.length; i++) caller.registers[base + i] = values[i];
      caller.callResultTop = base + values.length;
    } else {
      for (let i = 0; i < wanted; i++) caller.registers[base + i] = values[i];
    }
  }

  // ============================================================
  // Debug helpers
  // ============================================================

  getFrameAtLevel(level) {
    // Level 1 = the frame that called the debug function
    const depth = this.stack.depth();
    const idx = depth - level;
    if (idx < 0 || idx >= depth) return null;
    return this.stack.frames[idx];
  }

  getFrameInfoAtLevel(level) {
    const frame = this.getFrameAtLevel(level);
    if (!frame) return null;
    const proto = frame.proto;
    return {
      source: proto.source || '=[C]',
      shortSrc: proto.shortSrc || proto.source || '[C]',
      linedefined: proto.linedefined !== undefined ? proto.linedefined : -1,
      lastlinedefined: proto.lastlinedefined !== undefined ? proto.lastlinedefined : -1,
      what: proto.what || 'Lua',
      currentline: proto.lineForPC ? proto.lineForPC[frame.pc - 1] : -1,
      nups: (proto.upvalues || []).length,
      nparams: (proto.params || []).length,
      isvararg: !!proto.isVararg,
      func: null,
    };
  }

  getFunctionInfo(fn) {
    if (typeof fn === 'function') {
      return {
        source: '=[C]',
        shortSrc: '[C]',
        linedefined: -1,
        lastlinedefined: -1,
        what: 'C',
        currentline: -1,
        nups: 0,
        nparams: 0,
        isvararg: true,
        func: fn,
      };
    }
    if (fn && fn.__isClosure) {
      const proto = fn.__proto;
      return {
        source: proto.source || '=Lua',
        shortSrc: proto.shortSrc || proto.source || 'Lua',
        linedefined: proto.linedefined !== undefined ? proto.linedefined : -1,
        lastlinedefined: proto.lastlinedefined !== undefined ? proto.lastlinedefined : -1,
        what: proto.what || 'Lua',
        currentline: -1,
        nups: (proto.upvalues || []).length,
        nparams: (proto.params || []).length,
        isvararg: !!proto.isVararg,
        func: fn,
      };
    }
    return null;
  }

  getStackTrace() {
    const out = [];
    for (let i = this.stack.depth() - 1; i >= 0; i--) {
      const frame = this.stack.frames[i];
      const proto = frame.proto;
      out.push({
        source: proto.source || '=[C]',
        shortSrc: proto.shortSrc || proto.source || '[C]',
        currentline: proto.lineForPC ? proto.lineForPC[frame.pc - 1] : 0,
        linedefined: proto.linedefined || 0,
      });
    }
    return out;
  }
}

// ============================================================
// Convenience factory
// ============================================================

export function createVM(program, options) {
  return new VM2(program, options);
}

export default { VM2, createVM };