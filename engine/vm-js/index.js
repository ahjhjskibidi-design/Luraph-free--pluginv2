/**
 * VM — main interpreter entry.
 *
 * Usage:
 *   import { VM } from './engine/vm-js/index.js';
 *   const vm = new VM(program, { print: console.log });
 *   vm.run();
 *
 * Program shape (from the compiler):
 *   {
 *     version: 1,
 *     constants: [ { type, value } ],
 *     protos: [ Proto ],
 *     main: Proto
 *   }
 */

import { OP, OP_NAME } from './opcodes.js';
import { decode, decodeJump, rkValue, rkIsConst, rkIndex } from './decode.js';
import { Frame, Stack } from './stack.js';
import * as RT from './runtime.js';

/**
 * Convert the compiler's { type, value } constant entries into the
 * actual JS values the runtime expects.
 */
function loadConstants(entries) {
  const out = new Array(entries.length);
  for (let i = 0; i < entries.length; i++) {
    const e = entries[i];
    if (e.type === 0) out[i] = null;              // nil
    else if (e.type === 1) out[i] = e.value;      // bool
    else if (e.type === 2) out[i] = e.value;      // number
    else if (e.type === 3) out[i] = e.value;      // string
    else out[i] = null;
  }
  return out;
}

export class VM {
  constructor(program, options) {
    this.program = program;
    this.constants = loadConstants(program.constants);
    this.globals = (options && options.globals) || this.defaultGlobals();
    this.io = (options && options.io) || { print: console.log };
    this.stack = new Stack();
    this.maxDepth = 1000;
    this.steps = 0;
    this.maxSteps = (options && options.maxSteps) || 1000000;
  }

  /**
   * Default global environment. Mirrors the parts of the Lua standard
   * library that generated scripts commonly use.
   */
  defaultGlobals() {
    const io = { print: console.log };
    const self = this;
    return {
      print: (...args) => {
        const parts = args.map(RT.luaToString);
        if (self.io && self.io.print) {
          self.io.print(parts.join('\t'));
        } else {
          console.log(parts.join('\t'));
        }
      },
      type: (v) => RT.luaTypeName(v),
      tostring: (v) => RT.luaToString(v),
      tonumber: (v) => {
        if (typeof v === 'number') return v;
        const n = Number(v);
        return isNaN(n) ? null : n;
      },
      error: (msg) => {
        throw new Error(RT.luaToString(msg));
      },
      assert: (v, msg) => {
        if (!RT.luaTruthy(v)) {
          throw new Error(msg ? RT.luaToString(msg) : 'assertion failed');
        }
        return v;
      },
      string: {
        char: (...codes) => String.fromCharCode(...codes),
        len: (s) => s.length,
        sub: (s, i, j) => {
          i = i < 0 ? s.length + i + 1 : i;
          j = j === undefined ? s.length : (j < 0 ? s.length + j + 1 : j);
          return s.substring(i - 1, j);
        },
        rep: (s, n) => s.repeat(n),
        lower: (s) => s.toLowerCase(),
        upper: (s) => s.toUpperCase(),
        format: (fmt, ...args) => {
          // Minimal %s, %d, %f, %%
          let i = 0;
          return fmt.replace(/%[sdf]/g, () => RT.luaToString(args[i++]));
        },
      },
      table: {
        insert: (t, v) => { t[t.length] = v; },
        remove: (t) => t.pop(),
        concat: (t, sep) => {
          sep = sep === undefined ? '' : sep;
          return t.map(RT.luaToString).join(sep);
        },
      },
      math: {
        floor: Math.floor,
        ceil: Math.ceil,
        abs: Math.abs,
        max: Math.max,
        min: Math.min,
        sqrt: Math.sqrt,
        random: Math.random,
        pi: Math.PI,
        huge: Infinity,
      },
      unpack: (t) => {
        const out = [];
        for (let i = 1; i <= t.length; i++) out.push(t[i]);
        return out;
      },
    };
  }

  run() {
    const mainFrame = new Frame(this.program.main, this.constants, [], null, 0);
    this.stack.push(mainFrame);
    this.execute();
    return mainFrame.returnValues;
  }

  execute() {
    while (this.stack.depth() > 0) {
      const frame = this.stack.top();

      if (frame.pc >= frame.instructions.length) {
        // Fell off the end — implicit return
        this.doReturn(frame, []);
        continue;
      }

      if (++this.steps > this.maxSteps) {
        throw new Error('VM step limit exceeded (' + this.maxSteps + ')');
      }

      const word = frame.instructions[frame.pc];
      frame.pc++;
      const inst = decode(word);

      try {
        this.dispatch(frame, inst, word);
      } catch (err) {
        const name = OP_NAME[inst.op] || ('0x' + inst.op.toString(16));
        throw new Error(
          'VM error at pc ' + (frame.pc - 1) + ' (' + name + '): ' + err.message
        );
      }
    }
  }

  dispatch(frame, inst, word) {
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

      case OP.LOADVARARG:
        if (B === 0) {
          for (let i = 0; i < frame.varargs.length; i++) {
            regs[A + i] = frame.varargs[i];
          }
        } else {
          for (let i = 0; i < B; i++) regs[A + i] = frame.varargs[i];
        }
        return;

      case OP.MOVE:
        regs[A] = regs[B];
        return;

      case OP.GETGLOBAL: {
        const name = K[B];
        regs[A] = this.globals[name];
        return;
      }

      case OP.SETGLOBAL: {
        const name = K[B];
        this.globals[name] = regs[A];
        return;
      }

      case OP.NEWTABLE:
        regs[A] = {};
        return;

      case OP.GETTABLE: {
        const t = regs[B];
        const k = rkValue(regs, K, C);
        regs[A] = RT.luaGetTable(t, k);
        return;
      }

      case OP.SETTABLE: {
        const t = regs[A];
        const k = rkValue(regs, K, B);
        const v = rkValue(regs, K, C);
        RT.luaSetTable(t, k, v);
        return;
      }

      case OP.ADD:
        regs[A] = RT.luaAdd(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.SUB:
        regs[A] = RT.luaSub(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.MUL:
        regs[A] = RT.luaMul(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.DIV:
        regs[A] = RT.luaDiv(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.MOD:
        regs[A] = RT.luaMod(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.POW:
        regs[A] = RT.luaPow(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.UNM:
        regs[A] = RT.luaUnm(regs[B]);
        return;

      case OP.BAND:
        regs[A] = RT.luaBand(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.BOR:
        regs[A] = RT.luaBor(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.BXOR:
        regs[A] = RT.luaBxor(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.BNOT:
        regs[A] = RT.luaBnot(regs[B]);
        return;
      case OP.SHL:
        regs[A] = RT.luaShl(rkValue(regs, K, B), rkValue(regs, K, C));
        return;
      case OP.SHR:
        regs[A] = RT.luaShr(rkValue(regs, K, B), rkValue(regs, K, C));
        return;

      case OP.EQ: {
        const r = RT.luaEq(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.NE: {
        const r = RT.luaNe(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.LT: {
        const r = RT.luaLt(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.LE: {
        const r = RT.luaLe(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.GT: {
        const r = RT.luaGt(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }
      case OP.GE: {
        const r = RT.luaGe(rkValue(regs, K, B), rkValue(regs, K, C));
        if ((A !== 0) !== r) frame.pc++;
        return;
      }

      case OP.NOT:
        regs[A] = RT.luaNot(regs[B]);
        return;

      case OP.LEN:
        regs[A] = RT.luaLen(regs[B]);
        return;

      case OP.CONCAT:
        regs[A] = RT.luaConcat(regs, B, C);
        return;

      case OP.JMP: {
        const sBx = decodeJump(B, C);
        frame.pc += sBx;
        return;
      }

      case OP.TEST: {
        // If R[A] equals (B==1) in truthiness, skip next instruction
        const val = regs[A];
        const want = (B === 1);
        if (RT.luaTruthy(val) === want) frame.pc++;
        return;
      }

      case OP.CLOSURE: {
        const proto = this.program.protos[B];
        const upvalues = [];
        for (const up of proto.upvalues) {
          if (up.fromParentLocal !== undefined) {
            const reg = up.fromParentLocal;
            const parentFrame = frame;
            upvalues.push({
              get: () => parentFrame.registers[reg],
              set: (v) => { parentFrame.registers[reg] = v; },
            });
          } else if (up.fromParentUpvalue !== undefined) {
            upvalues.push(frame.upvalues[up.fromParentUpvalue]);
          } else {
            upvalues.push({ get: () => null, set: () => {} });
          }
        }
        regs[A] = {
          __isClosure: true,
          __proto: proto,
          __upvalues: upvalues,
        };
        return;
      }

      case OP.CALL: {
        const funcReg = A;
        const nargs = B;
        const nresults = C - 1;

        const func = regs[funcReg];
        const args = [];
        for (let i = 0; i < nargs; i++) args.push(regs[funcReg + 1 + i]);

        if (func && func.__isClosure) {
          if (this.stack.depth() >= this.maxDepth) {
            throw new Error('stack overflow');
          }
          const newFrame = new Frame(
            func.__proto,
            this.constants,
            args,
            funcReg,
            0
          );
          newFrame.upvalues = func.__upvalues;
          newFrame.callerFrame = frame;
          newFrame.callerPC = frame.pc;
          newFrame.returnRegister = funcReg;
          newFrame.nresults = nresults;
          this.stack.push(newFrame);
          return;
        }

        if (typeof func === 'function') {
          const results = func(...args);
          const resultList = Array.isArray(results) ? results : [results];
          for (let i = 0; i < nresults; i++) {
            regs[funcReg + i] = resultList[i];
          }
          return;
        }

        throw new Error('attempt to call a ' + RT.luaTypeName(func) + ' value');
      }

      case OP.RETURN: {
        const base = A;
        const count = B - 1;
        const values = [];
        for (let i = 0; i < count; i++) {
          values.push(regs[base + i]);
        }
        this.doReturn(frame, values);
        return;
      }

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

      case OP.HALT:
        this.stack.frames.length = 0;
        return;

      default:
        throw new Error('unknown opcode 0x' + op.toString(16));
    }
  }

  /**
   * Handle a return from the current frame.
   * If there is a caller, write the results into the caller's registers.
   */
  doReturn(frame, values) {
    this.stack.pop();
    const caller = frame.callerFrame;
    if (!caller) return;
    const returnReg = frame.returnRegister;
    const nresults = frame.nresults;
    for (let i = 0; i < nresults; i++) {
      caller.registers[returnReg + i] = values[i];
    }
    if (frame.callerPC !== undefined) caller.pc = frame.callerPC;
  }
}

export default { VM };