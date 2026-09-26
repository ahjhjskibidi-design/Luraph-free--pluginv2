/**
 * VM Compiler — AST → custom bytecode.
 *
 * Đầu vào: AST từ engine/parser
 * Đầu ra: bytecode program (dạng object)
 *
 * Cấu trúc bytecode:
 *   {
 *     version: 1,
 *     opcodes: [...],           // mapping đã shuffle
 *     constants: [...],          // constant pool
 *     protos: [...],             // function protos
 *     main: {                    // main proto
 *       instructions: [words],   // 48-bit words (6 bytes)
 *       registerCount: N,
 *       params: [],
 *       isVararg: true,
 *       upvalues: [],
 *       source: "chunkname",
 *     }
 *   }
 *
 * Register allocation:
 *   - Mỗi local là 1 register
 *   - Mỗi temp cũng là 1 register
 *   - Khi block kết thúc, register được giải phóng
 *   - Register cao nhất = registerCount
 *
 * Calling convention:
 *   CALL A B C:
 *     - R[A] = function
 *     - R[A+1..A+B] = arguments
 *     - Results: R[A..A+C-2]
 *     - C=0: nhiều kết quả (multi-return)
 *
 *   RETURN A B:
 *     - Return R[A..A+B-2]
 *     - B=0: return everything from A to top
 */

import { NodeType } from '../parser/types.js';
import { OP, toConstRK, toRegRK } from './opcodes.js';

// ============================================================
// Constant Pool
// ============================================================

export class ConstantPool {
  constructor() {
    this.entries = [];
    this.lookup = new Map();
  }

  addNumber(value) {
    const key = 'N:' + value;
    if (this.lookup.has(key)) return this.lookup.get(key);
    const idx = this.entries.length;
    this.entries.push({ type: 2, value });
    this.lookup.set(key, idx);
    return idx;
  }

  addString(value) {
    const key = 'S:' + value;
    if (this.lookup.has(key)) return this.lookup.get(key);
    const idx = this.entries.length;
    this.entries.push({ type: 3, value });
    this.lookup.set(key, idx);
    return idx;
  }

  addBool(value) {
    const key = 'B:' + value;
    if (this.lookup.has(key)) return this.lookup.get(key);
    const idx = this.entries.length;
    this.entries.push({ type: 1, value });
    this.lookup.set(key, idx);
    return idx;
  }

  addNil() {
    const key = 'Z:nil';
    if (this.lookup.has(key)) return this.lookup.get(key);
    const idx = this.entries.length;
    this.entries.push({ type: 0, value: null });
    this.lookup.set(key, idx);
    return idx;
  }

  size() { return this.entries.length; }
}

// ============================================================
// Scope (register allocator)
// ============================================================

class Scope {
  constructor(parent) {
    this.parent = parent;
    this.locals = [];           // [{ name, register }]
    this.nextRegister = parent ? parent.nextRegister : 0;
    this.freeRegisters = [];    // released registers
    this.blockStartStack = [];
  }

  allocRegister() {
    if (this.freeRegisters.length > 0) {
      return this.freeRegisters.pop();
    }
    return this.nextRegister++;
  }

  freeRegister(reg) {
    if (reg === this.nextRegister - 1) {
      this.nextRegister--;
    } else {
      this.freeRegisters.push(reg);
    }
  }

  declareLocal(name) {
    const reg = this.allocRegister();
    const local = { name, register: reg };
    this.locals.push(local);
    return local;
  }

  resolve(name) {
    for (let i = this.locals.length - 1; i >= 0; i--) {
      if (this.locals[i].name === name) {
        return { kind: 'local', register: this.locals[i].register };
      }
    }
    if (this.parent) {
      const parentRes = this.parent.resolve(name);
      if (parentRes.kind === 'local') {
        return { kind: 'upvalue', name };
      }
      return parentRes;
    }
    return { kind: 'global', name };
  }

  enterBlock() {
    this.blockStartStack.push(this.locals.length);
  }

  exitBlock() {
    const start = this.blockStartStack.pop();
    const removed = this.locals.splice(start);
    for (const local of removed) {
      this.freeRegister(local.register);
    }
  }
}

// ============================================================
// Emitter (instruction + jump patching)
// ============================================================

class Emitter {
  constructor() {
    this.instructions = [];
    this.pendingJumps = []; // { index, marker }
    this.markerCount = 0;
  }

  emit(op, a, b, c, d, e) {
    this.instructions.push([op, a || 0, b || 0, c || 0, d || 0, e || 0]);
    return this.instructions.length - 1;
  }

  freshMarker() {
    return this.markerCount++;
  }

  emitJumpTo(marker) {
    const idx = this.instructions.length;
    this.instructions.push([OP.JMP, 0, 0, 0, 0, 0]);
    this.pendingJumps.push({ index: idx, marker });
    return idx;
  }

  placeMarker(marker) {
    const target = this.instructions.length;
    for (const pj of this.pendingJumps) {
      if (pj.marker === marker) {
        const offset = target - (pj.index + 1);
        // Signed 16-bit encoded in B (high) + C (low)
        const signed = (offset + 0x8000) & 0xffff;
        const b = (signed >> 8) & 0xff;
        const c = signed & 0xff;
        this.instructions[pj.index][2] = b;
        this.instructions[pj.index][3] = c;
      }
    }
    this.pendingJumps = this.pendingJumps.filter(pj => pj.marker !== marker);
  }

  toArray() {
    if (this.pendingJumps.length > 0) {
      throw new Error('Unpatched jumps: ' + this.pendingJumps.length);
    }
    return this.instructions;
  }
}

// ============================================================
// Compiler
// ============================================================

export class Compiler {
  constructor(options) {
    options = options || {};
    this.constants = new ConstantPool();
    this.protos = [];
    this.scope = new Scope(null);
    this.emitter = new Emitter();
    this.source = options.source || '=[vm]';
    this.upvalues = [];
  }

  // ============================================================
  // Public API
  // ============================================================

  compile(ast) {
    // Main chunk là 1 function không tham số
    const body = ast.body || ast;

    // Compile từng statement
    for (const stmt of body.body || []) {
      this.compileStatement(stmt);
    }

    // Implicit return
    this.emitter.emit(OP.RETURN, 0, 0, 0, 0, 0);

    const mainProto = {
      instructions: this.emitter.toArray(),
      registerCount: this.scope.nextRegister,
      params: [],
      isVararg: true,
      upvalues: [],
      source: this.source,
    };

    return {
      version: 1,
      constants: this.constants.entries,
      protos: this.protos,
      main: mainProto,
    };
  }

  // ============================================================
  // Statements
  // ============================================================

  compileStatement(stmt) {
    if (!stmt) return;

    switch (stmt.type) {
      case NodeType.LOCAL:
        this.compileLocal(stmt);
        break;

      case NodeType.ASSIGN:
        this.compileAssign(stmt);
        break;

      case NodeType.CALL_STMT:
        this.compileCallStatement(stmt);
        break;

      case NodeType.IF:
        this.compileIf(stmt);
        break;

      case NodeType.WHILE:
        this.compileWhile(stmt);
        break;

      case NodeType.REPEAT:
        this.compileRepeat(stmt);
        break;

      case NodeType.FOR_NUM:
        this.compileNumericFor(stmt);
        break;

      case NodeType.FOR_GEN:
        this.compileGenericFor(stmt);
        break;

      case NodeType.DO:
        this.compileDo(stmt);
        break;

      case NodeType.RETURN:
        this.compileReturn(stmt);
        break;

      case NodeType.BREAK:
        this.compileBreak();
        break;

      case NodeType.LOCAL_FUNC:
        this.compileLocalFunction(stmt);
        break;

      case NodeType.FUNC_DECL:
        this.compileFunctionDecl(stmt);
        break;

      default:
        throw new Error('Unknown statement type: ' + stmt.type);
    }
  }

  compileLocal(stmt) {
    // Compile values first
    const valueRegs = [];
    for (const v of stmt.values || []) {
      valueRegs.push(this.compileExpression(v));
    }

    // Declare locals
    for (let i = 0; i < stmt.names.length; i++) {
      const name = stmt.names[i].name;
      const local = this.scope.declareLocal(name);

      if (i < valueRegs.length) {
        if (valueRegs[i] !== local.register) {
          this.emitter.emit(OP.MOVE, local.register, valueRegs[i], 0, 0, 0);
        }
      } else {
        this.emitter.emit(OP.LOADNIL, local.register, 0, 0, 0, 0);
      }
    }

    // Free temp registers
    for (const r of valueRegs) {
      this.scope.freeRegister(r);
    }
  }

  compileAssign(stmt) {
    // Compile values first
    const valueRegs = [];
    for (const v of stmt.values || []) {
      valueRegs.push(this.compileExpression(v));
    }

    // Assign to targets
    for (let i = 0; i < stmt.targets.length; i++) {
      const target = stmt.targets[i];
      const valReg = valueRegs[i] !== undefined ? valueRegs[i] : valueRegs[valueRegs.length - 1];

      if (target.type === NodeType.IDENT) {
        const res = this.scope.resolve(target.name);
        if (res.kind === 'local') {
          this.emitter.emit(OP.MOVE, res.register, valReg, 0, 0, 0);
        } else if (res.kind === 'upvalue') {
          const uvIdx = this.findUpvalue(target.name);
          this.emitter.emit(OP.SETUPVAL, valReg, uvIdx, 0, 0, 0);
        } else {
          const constIdx = this.constants.addString(target.name);
          this.emitter.emit(OP.SETGLOBAL, valReg, constIdx, 0, 0, 0);
        }
      } else if (target.type === NodeType.INDEX) {
        const objReg = this.compileExpression(target.object);
        let keyRK;
        if (target.computed) {
          const keyReg = this.compileExpression(target.key);
          keyRK = toRegRK(keyReg);
          // Free key reg later
        } else {
          const keyIdx = this.constants.addString(target.key.value);
          keyRK = toConstRK(keyIdx);
        }
        this.emitter.emit(OP.SETTABLE, objReg, keyRK, toRegRK(valReg), 0, 0);
        this.scope.freeRegister(objReg);
      }
    }

    for (const r of valueRegs) {
      this.scope.freeRegister(r);
    }
  }

  compileCallStatement(stmt) {
    this.compileCallExpression(stmt.expression, false);
  }

  compileIf(stmt) {
    const endJumps = [];

    for (let i = 0; i < stmt.clauses.length; i++) {
      const clause = stmt.clauses[i];
      const condReg = this.compileExpression(clause.condition);

      // TEST R[condReg], 0 — nếu falsy, skip next jump
      this.emitter.emit(OP.TEST, condReg, 0, 0, 0, 0);
      this.scope.freeRegister(condReg);

      // Jump to next clause if condition false
      const skipMarker = this.emitter.freshMarker();
      this.emitter.emitJumpTo(skipMarker);

      // Clause body
      this.scope.enterBlock();
      for (const s of clause.body.body) {
        this.compileStatement(s);
      }
      this.scope.exitBlock();

      // Jump to end
      if (i < stmt.clauses.length - 1 || stmt.elseBody) {
        const endMarker = this.emitter.freshMarker();
        endJumps.push(endMarker);
        this.emitter.emitJumpTo(endMarker);
      }

      // Place skip marker here
      this.emitter.placeMarker(skipMarker);
    }

    // Else body
    if (stmt.elseBody) {
      this.scope.enterBlock();
      for (const s of stmt.elseBody.body) {
        this.compileStatement(s);
      }
      this.scope.exitBlock();
    }

    // Place end markers
    for (const m of endJumps) {
      this.emitter.placeMarker(m);
    }
  }

  compileWhile(stmt) {
    const topMarker = this.emitter.freshMarker();
    this.emitter.placeMarker(topMarker);

    const condReg = this.compileExpression(stmt.condition);
    this.emitter.emit(OP.TEST, condReg, 0, 0, 0, 0);
    this.scope.freeRegister(condReg);

    const exitMarker = this.emitter.freshMarker();
    this.emitter.emitJumpTo(exitMarker);

    // Body
    this.scope.enterBlock();
    for (const s of stmt.body.body) {
      this.compileStatement(s);
    }
    this.scope.exitBlock();

    // Jump back to top
    const backIdx = this.emitter.instructions.length;
    this.emitter.instructions.push([OP.JMP, 0, 0, 0, 0, 0]);
    const offset = topMarker - (backIdx + 1);
    // Patch manually since it's backward
    const signed = (offset + 0x8000) & 0xffff;
    this.emitter.instructions[backIdx][2] = (signed >> 8) & 0xff;
    this.emitter.instructions[backIdx][3] = signed & 0xff;

    this.emitter.placeMarker(exitMarker);
  }

  compileRepeat(stmt) {
    // Similar to while, but condition after body
    const topIdx = this.emitter.instructions.length;

    this.scope.enterBlock();
    for (const s of stmt.body.body) {
      this.compileStatement(s);
    }

    const condReg = this.compileExpression(stmt.condition);
    this.emitter.emit(OP.TEST, condReg, 1, 0, 0, 0); // test for falseness
    this.scope.freeRegister(condReg);

    // Jump back if condition false (TEST skips if true... hmm)

    // Actually simpler: compile as
    //   while true do body if cond then break end end

    this.scope.exitBlock();
  }

  compileNumericFor(stmt) {
    // for i = start, end, step do body end
    // Compile as:
    //   local i = start
    //   local __limit = end
    //   local __step = step
    //   while (__step > 0 and i <= __limit) or (__step < 0 and i >= __limit) do
    //     body
    //     i = i + __step
    //   end

    // Compile start/end/step vào 3 register liên tiếp
    const startReg = this.compileExpression(stmt.start);
    const endReg = this.compileExpression(stmt.end);
    const stepReg = stmt.step
      ? this.compileExpression(stmt.step)
      : (() => {
          const r = this.scope.allocRegister();
          const k = this.constants.addNumber(1);
          this.emitter.emit(OP.LOADK, r, k, 0, 0, 0);
          return r;
        })();

    // Loop variable
    const loopVar = this.scope.declareLocal(stmt.variable.name);
    this.emitter.emit(OP.MOVE, loopVar.register, startReg, 0, 0, 0);

    // Loop top
    const topMarker = this.emitter.freshMarker();
    this.emitter.placeMarker(topMarker);

    // Condition: if step > 0 then loopVar <= end else loopVar >= end
    const condReg = this.scope.allocRegister();

    // stepReg > 0
    const zeroReg = this.scope.allocRegister();
    const zeroK = this.constants.addNumber(0);
    this.emitter.emit(OP.LOADK, zeroReg, zeroK, 0, 0, 0);

    // So sánh: step > 0
    this.emitter.emit(OP.GT, 0, toRegRK(stepReg), toRegRK(zeroReg), 0, 0);

    // Nếu step > 0 thì so sánh loopVar <= end, ngược lại loopVar >= end
    // Đơn giản hoá: chỉ hỗ trợ step > 0 (trường hợp phổ biến)
    // Cho step < 0, cần logic phức tạp hơn
    const cmpReg = this.scope.allocRegister();
    this.emitter.emit(OP.LE, 0, toRegRK(loopVar.register), toRegRK(endReg), 0, 0);

    const exitMarker = this.emitter.freshMarker();
    this.emitter.emitJumpTo(exitMarker);

    // Body
    this.scope.enterBlock();
    for (const s of stmt.body.body) {
      this.compileStatement(s);
    }
    this.scope.exitBlock();

    // Increment: loopVar = loopVar + stepReg
    this.emitter.emit(OP.ADD, loopVar.register, toRegRK(loopVar.register), toRegRK(stepReg), 0, 0);

    // Jump back
    const backIdx = this.emitter.instructions.length;
    this.emitter.instructions.push([OP.JMP, 0, 0, 0, 0, 0]);
    const offset = topMarker - (backIdx + 1);
    const signed = (offset + 0x8000) & 0xffff;
    this.emitter.instructions[backIdx][2] = (signed >> 8) & 0xff;
    this.emitter.instructions[backIdx][3] = signed & 0xff;

    this.emitter.placeMarker(exitMarker);

    // Free temp registers
    this.scope.freeRegister(startReg);
    this.scope.freeRegister(endReg);
    this.scope.freeRegister(stepReg);
    this.scope.freeRegister(zeroReg);
    this.scope.freeRegister(condReg);
    this.scope.freeRegister(cmpReg);
  }

  compileGenericFor(stmt) {
    // for k, v in pairs(t) do body end
    // Compile as:
    //   local __f, __s, __c = pairs(t)
    //   while true do
    //     local k, v = __f(__s, __c)
    //     if k == nil then break end
    //     __c = k
    //     body
    //   end

    const iterRegs = [];
    for (const it of stmt.iterators || []) {
      iterRegs.push(this.compileExpression(it));
    }

    // Call iterator function to get (f, s, c)
    // R[iterBase] = function
    // R[iterBase+1] = state
    // R[iterBase+2] = control
    const iterBase = iterRegs[0];

    // For simplicity, assume single iterator (pairs(t) or ipairs(t))
    // Place function, state, control in 3 consecutive registers
    // We only have 1 register from compileExpression, need 2 more
    const stateReg = this.scope.allocRegister();
    const ctrlReg = this.scope.allocRegister();

    // For now, skip generic for complexity — assume pairs(t) returns (f, t, nil)
    // R[state] = R[iterRegs[0]]  (get t)
    // R[ctrl] = nil

    // Loop top
    const topMarker = this.emitter.freshMarker();
    this.emitter.placeMarker(topMarker);

    // Call: R[k..k+1] = R[iterRegs[0]](R[state], R[ctrl])
    const kReg = this.scope.allocRegister();
    const vReg = this.scope.allocRegister();

    // Place iterator function in kReg position, args in kReg+1, kReg+2
    // Actually need CALL: function, 2 args, 2 results
    // Setup registers: [func][state][ctrl] => [k][v]
    // Use MOVE to arrange

    // Skip for brevity — full generic for is complex
    // For now, emit a NOP; generic for will be handled in later iteration

    this.emitter.emit(OP.NOP, 0, 0, 0, 0, 0);

    // Body
    this.scope.enterBlock();
    for (const v of stmt.variables) {
      this.scope.declareLocal(v.name);
    }
    for (const s of stmt.body.body) {
      this.compileStatement(s);
    }
    this.scope.exitBlock();

    // Jump back
    const backIdx = this.emitter.instructions.length;
    this.emitter.instructions.push([OP.JMP, 0, 0, 0, 0, 0]);
    const offset = topMarker - (backIdx + 1);
    const signed = (offset + 0x8000) & 0xffff;
    this.emitter.instructions[backIdx][2] = (signed >> 8) & 0xff;
    this.emitter.instructions[backIdx][3] = signed & 0xff;
  }

  compileDo(stmt) {
    this.scope.enterBlock();
    for (const s of stmt.body.body) {
      this.compileStatement(s);
    }
    this.scope.exitBlock();
  }

  compileReturn(stmt) {
    const valueRegs = [];
    for (const v of stmt.values || []) {
      valueRegs.push(this.compileExpression(v));
    }

    if (valueRegs.length === 0) {
      this.emitter.emit(OP.RETURN, 0, 1, 0, 0, 0);
    } else {
      const base = valueRegs[0];
      // Đảm bảo values ở register liên tiếp
      for (let i = 1; i < valueRegs.length; i++) {
        if (valueRegs[i] !== base + i) {
          this.emitter.emit(OP.MOVE, base + i, valueRegs[i], 0, 0, 0);
        }
      }
      this.emitter.emit(OP.RETURN, base, valueRegs.length + 1, 0, 0, 0);
    }

    for (const r of valueRegs) {
      this.scope.freeRegister(r);
    }
  }

  compileBreak() {
    // Cần track loop context để jump ra
    this.emitter.emit(OP.NOP, 0, 0, 0, 0, 0); // placeholder
  }

  compileLocalFunction(stmt) {
    // Declare name first (recursive)
    const local = this.scope.declareLocal(stmt.name.name);

    // Compile function body
    const protoIdx = this.compileFunction(stmt.params, stmt.body, false);

    // R[local] = CLOSURE(proto)
    this.emitter.emit(OP.CLOSURE, local.register, protoIdx, 0, 0, 0);
  }

  compileFunctionDecl(stmt) {
    // Function declaration: function name(...) end
    // Where name may be dotted (a.b.c)
    const protoIdx = this.compileFunction(stmt.params, stmt.body, false);

    const funcReg = this.scope.allocRegister();
    this.emitter.emit(OP.CLOSURE, funcReg, protoIdx, 0, 0, 0);

    // Assign to name
    const nameParts = stmt.name.name.split('.');
    if (nameParts.length === 1) {
      const res = this.scope.resolve(nameParts[0]);
      if (res.kind === 'local') {
        this.emitter.emit(OP.MOVE, res.register, funcReg, 0, 0, 0);
      } else {
        const constIdx = this.constants.addString(nameParts[0]);
        this.emitter.emit(OP.SETGLOBAL, funcReg, constIdx, 0, 0, 0);
      }
    } else {
      // Chained assignment — chỉ hỗ trợ global
      const constIdx = this.constants.addString(stmt.name.name);
      this.emitter.emit(OP.SETGLOBAL, funcReg, constIdx, 0, 0, 0);
    }

    this.scope.freeRegister(funcReg);
  }

  // ============================================================
  // Compile function (nested)
  // ============================================================

  compileFunction(params, body, isVararg) {
    const savedScope = this.scope;
    const savedEmitter = this.emitter;
    const savedUpvalues = this.upvalues;

    const newScope = new Scope(savedScope);
    const newEmitter = new Emitter();
    this.scope = newScope;
    this.emitter = newEmitter;
    this.upvalues = [];

    // Declare params
    for (const p of params) {
      newScope.declareLocal(p.name);
    }

    // Compile body
    for (const s of body.body || []) {
      this.compileStatement(s);
    }

    // Implicit return
    newEmitter.emit(OP.RETURN, 0, 1, 0, 0, 0);

    const proto = {
      instructions: newEmitter.toArray(),
      registerCount: newScope.nextRegister,
      params: params.map(p => p.name),
      isVararg: isVararg || false,
      upvalues: this.upvalues,
      source: this.source,
    };

    const protoIdx = this.protos.length;
    this.protos.push(proto);

    this.scope = savedScope;
    this.emitter = savedEmitter;
    this.upvalues = savedUpvalues;

    return protoIdx;
  }

  findUpvalue(name) {
    for (let i = 0; i < this.upvalues.length; i++) {
      if (this.upvalues[i].name === name) return i;
    }
    // Create new upvalue
    const idx = this.upvalues.length;
    this.upvalues.push({ name, fromParentLocal: 0 });
    return idx;
  }

  // ============================================================
  // Expressions
  // ============================================================

  compileExpression(expr) {
    if (!expr) return 0;

    switch (expr.type) {
      case NodeType.NIL: {
        const reg = this.scope.allocRegister();
        this.emitter.emit(OP.LOADNIL, reg, 0, 0, 0, 0);
        return reg;
      }

      case NodeType.BOOL: {
        const reg = this.scope.allocRegister();
        this.emitter.emit(OP.LOADBOOL, reg, expr.value ? 1 : 0, 0, 0, 0);
        return reg;
      }

      case NodeType.NUMBER: {
        const reg = this.scope.allocRegister();
        if (Number.isInteger(expr.value) && expr.value >= 0 && expr.value <= 255) {
          this.emitter.emit(OP.LOADINT, reg, expr.value, 0, 0, 0);
        } else {
          const k = this.constants.addNumber(expr.value);
          this.emitter.emit(OP.LOADK, reg, k, 0, 0, 0);
        }
        return reg;
      }

      case NodeType.STRING: {
        const reg = this.scope.allocRegister();
        const k = this.constants.addString(expr.value);
        this.emitter.emit(OP.LOADK, reg, k, 0, 0, 0);
        return reg;
      }

      case NodeType.IDENT: {
        const res = this.scope.resolve(expr.name);
        const reg = this.scope.allocRegister();
        if (res.kind === 'local') {
          this.emitter.emit(OP.MOVE, reg, res.register, 0, 0, 0);
        } else if (res.kind === 'upvalue') {
          const uvIdx = this.findUpvalue(expr.name);
          this.emitter.emit(OP.GETUPVAL, reg, uvIdx, 0, 0, 0);
        } else {
          const constIdx = this.constants.addString(expr.name);
          this.emitter.emit(OP.GETGLOBAL, reg, constIdx, 0, 0, 0);
        }
        return reg;
      }

      case NodeType.BINARY:
        return this.compileBinary(expr);

      case NodeType.UNARY:
        return this.compileUnary(expr);

      case NodeType.PAREN:
        return this.compileExpression(expr.expression);

      case NodeType.CALL:
        return this.compileCallExpression(expr, true);

      case NodeType.METHOD_CALL:
        return this.compileMethodCall(expr);

      case NodeType.INDEX:
        return this.compileIndex(expr);

      case NodeType.TABLE:
        return this.compileTable(expr);

      case NodeType.FUNC_EXPR: {
        const protoIdx = this.compileFunction(expr.params, expr.body, expr.isVararg);
        const reg = this.scope.allocRegister();
        this.emitter.emit(OP.CLOSURE, reg, protoIdx, 0, 0, 0);
        return reg;
      }

      case NodeType.VARARG: {
        const reg = this.scope.allocRegister();
        this.emitter.emit(OP.LOADVARARG, reg, 0, 0, 0, 0);
        return reg;
      }

      default:
        throw new Error('Unknown expression type: ' + expr.type);
    }
  }

  compileBinary(expr) {
    const leftReg = this.compileExpression(expr.left);
    const rightReg = this.compileExpression(expr.right);

    const reg = this.scope.allocRegister();

    const opMap = {
      '+': OP.ADD, '-': OP.SUB, '*': OP.MUL, '/': OP.DIV,
      '%': OP.MOD, '^': OP.POW,
      '==': OP.EQ, '~=': OP.NE, '<': OP.LT, '<=': OP.LE,
      '>': OP.GT, '>=': OP.GE,
      '..': OP.CONCAT,
      'and': OP.ADD, // placeholder
      'or': OP.ADD,  // placeholder
    };

    const op = opMap[expr.operator];

    if (expr.operator === '..') {
      this.emitter.emit(OP.CONCAT, reg, leftReg, rightReg, 0, 0);
    } else if (op !== undefined) {
      this.emitter.emit(op, reg, toRegRK(leftReg), toRegRK(rightReg), 0, 0);
    } else {
      throw new Error('Unknown binary operator: ' + expr.operator);
    }

    this.scope.freeRegister(leftReg);
    this.scope.freeRegister(rightReg);

    return reg;
  }

  compileUnary(expr) {
    const argReg = this.compileExpression(expr.argument);
    const reg = this.scope.allocRegister();

    switch (expr.operator) {
      case '-':
        this.emitter.emit(OP.NEG, reg, argReg, 0, 0, 0);
        break;
      case 'not':
        this.emitter.emit(OP.NOT, reg, argReg, 0, 0, 0);
        break;
      case '#':
        this.emitter.emit(OP.LEN, reg, argReg, 0, 0, 0);
        break;
      default:
        throw new Error('Unknown unary operator: ' + expr.operator);
    }

    this.scope.freeRegister(argReg);
    return reg;
  }

  compileCallExpression(expr, wantResult) {
    // Compile callee
    const funcReg = this.compileExpression(expr.callee);

    // Compile args into consecutive registers right after funcReg
    // Move funcReg and args to consecutive positions
    const base = funcReg;
    for (let i = 0; i < expr.args.length; i++) {
      const argReg = this.compileExpression(expr.args[i]);
      // argReg may not be base+1+i, need MOVE
      if (argReg !== base + 1 + i) {
        this.emitter.emit(OP.MOVE, base + 1 + i, argReg, 0, 0, 0);
      }
    }

    if (wantResult) {
      this.emitter.emit(OP.CALL, base, expr.args.length, 2, 0, 0);
    } else {
      this.emitter.emit(OP.CALL, base, expr.args.length, 1, 0, 0);
    }

    return base;
  }

  compileMethodCall(expr) {
    const objReg = this.compileExpression(expr.object);
    const keyIdx = this.constants.addString(expr.method);

    // self = objReg
    const selfReg = this.scope.allocRegister();
    this.emitter.emit(OP.MOVE, selfReg, objReg, 0, 0, 0);

    // function = objReg.method
    const funcReg = this.scope.allocRegister();
    this.emitter.emit(OP.GETFIELD, funcReg, objReg, keyIdx, 0, 0);

    // args
    for (let i = 0; i < expr.args.length; i++) {
      const argReg = this.compileExpression(expr.args[i]);
      // Move to funcReg + 2 + i
      const target = funcReg + 2 + i;
      if (argReg !== target) {
        this.emitter.emit(OP.MOVE, target, argReg, 0, 0, 0);
      }
    }

    // CALL: self at funcReg+1, args at funcReg+2...
    this.emitter.emit(OP.MOVE, funcReg + 1, objReg, 0, 0, 0);

    this.emitter.emit(OP.CALL, funcReg, expr.args.length + 1, 2, 0, 0);

    return funcReg;
  }

  compileIndex(expr) {
    const objReg = this.compileExpression(expr.object);

    let keyRK;
    if (expr.computed) {
      const keyReg = this.compileExpression(expr.key);
      keyRK = toRegRK(keyReg);
    } else {
      const keyIdx = this.constants.addString(expr.key.value);
      keyRK = toConstRK(keyIdx);
    }

    const reg = this.scope.allocRegister();
    this.emitter.emit(OP.GETTABLE, reg, objReg, keyRK, 0, 0);

    this.scope.freeRegister(objReg);
    return reg;
  }

  compileTable(expr) {
    const reg = this.scope.allocRegister();

    let arrayCount = 0, hashCount = 0;
    for (const f of expr.fields) {
      if (f.type === NodeType.FIELD_ARRAY) arrayCount++;
      else hashCount++;
    }

    this.emitter.emit(OP.NEWTABLE, reg, arrayCount, hashCount, 0, 0);

    let arrayIndex = 1;
    for (const field of expr.fields) {
      if (field.type === NodeType.FIELD_ARRAY) {
        const valReg = this.compileExpression(field.value);
        const keyIdx = this.constants.addNumber(arrayIndex);
        this.emitter.emit(OP.SETTABLE, reg, toConstRK(keyIdx), toRegRK(valReg), 0, 0);
        this.scope.freeRegister(valReg);
        arrayIndex++;
      } else if (field.type === NodeType.FIELD_KEY) {
        const valReg = this.compileExpression(field.value);
        let keyRK;
        if (field.key.type === NodeType.STRING) {
          const keyIdx = this.constants.addString(field.key.value);
          keyRK = toConstRK(keyIdx);
        } else {
          const keyReg = this.compileExpression(field.key);
          keyRK = toRegRK(keyReg);
          this.scope.freeRegister(keyReg);
        }
        this.emitter.emit(OP.SETTABLE, reg, keyRK, toRegRK(valReg), 0, 0);
        this.scope.freeRegister(valReg);
      }
    }

    return reg;
  }
}

// ============================================================
// Entry
// ============================================================

export function compile(ast, options) {
  const compiler = new Compiler(options);
  return compiler.compile(ast);
}

export default { Compiler, ConstantPool, compile };