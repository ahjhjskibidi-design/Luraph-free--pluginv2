/**
 * Compiler — main entry point.
 *
 * Usage:
 *   import { compile } from './engine/compiler/index.js';
 *   const bytecode = compile(ast);
 *
 * A compiled program is an object:
 *   {
 *     version: 1,
 *     constants: [ { type, value }, ... ],
 *     protos: [ Proto, ... ],
 *     main: Proto
 *   }
 *
 * A Proto is:
 *   {
 *     instructions: [Uint32],
 *     params: [string],
 *     isVararg: boolean,
 *     upvalues: [ { name, fromParentLocal?, fromParentUpvalue? } ],
 *     registerCount: number
 *   }
 */

import { ConstantPool } from './constants.js';
import { Scope } from './scopes.js';
import { Emitter } from './emitter.js';
import { OP } from './opcodes.js';
import { encodeJump } from './instruction.js';
import { compileStmt } from './compile-stmt.js';
 compileExpr } from './compile-expr.js';

class Compiler {
  constructor() {
    this.constants = new ConstantPool();
    this.protos = [];
    this.scope = null;
    this.emitter = null;
    this.breakStack = [];
    this.pendingBreaks = [];
    this.tempManaged = new Set();
  }

  // Proxy helpers so expression/statement compilers can write
  // naturally: C.emit(...), C.compileNestedFunction(...)
  get instructions() { return this.emitter.instructions; }
  set instructions(v) { this.emitter.instructions = v; }

  emit(op, a, b, c) {
    return this.emitter.emit(op, a, b, c);
  }

  emitJumpForward(op) {
    return this.emitter.emitJumpForward(op);
  }

  patchHere(idx) {
    this.emitter.patchHere(idx);
  }

  /**
   * Patch a backward jump (from current position to an earlier marker).
   */
  patchBackward(jumpIndex, target) {
    const offset = target - (jumpIndex + 1);
    this.emitter.instructions[jumpIndex] = encodeJump(OP.JMP, 0, offset);
  }

  compileNestedFunction(funcNode) {
    const savedScope = this.scope;
    const savedEmitter = this.emitter;
    const savedBreaks = this.breakStack;

    const newScope = new Scope(savedScope);
    const newEmitter = new Emitter();

    this.scope = newScope;
    this.emitter = newEmitter;
    this.breakStack = [];

    // Declare parameters
    for (const p of funcNode.params) {
      newScope.declareLocal(p.name);
    }

    // Compile body
    for (const stmt of funcNode.body.body) {
      compileStmt(this, stmt);
    }

    // Implicit return at end
    this.emit(OP.RETURN, 0, 0, 0);

    const proto = {
      instructions: newEmitter.toArray(),
      params: funcNode.params.map(p => p.name),
      isVararg: !!funcNode.isVararg,
      upvalues: newScope.upvalues.slice(),
      registerCount: newScope.nextRegister,
    };

    this.scope = savedScope;
    this.emitter = savedEmitter;
    this.breakStack = savedBreaks;

    return proto;
  }

  addProto(proto) {
    const idx = this.protos.length;
    this.protos.push(proto);
    return idx;
  }
}

/**
 * Compile a parsed AST into a program object.
 */
export function compile(ast) {
  const C = new Compiler();
  C.scope = new Scope(null);
  C.emitter = new Emitter();

  for (const stmt of ast.body.body) {
    compileStmt(C, stmt);
  }

  C.emit(OP.RETURN, 0, 0, 0);

  return {
    version: 1,
    constants: C.constants.entries,
    protos: C.protos,
    main: {
      instructions: C.emitter.toArray(),
      params: [],
      isVararg: true,
      upvalues: [],
      registerCount: C.scope.nextRegister,
    },
  };
}

export default { compile };