/**
 * Compile expressions to bytecode.
 *
 * Every expression compiler places its result in a target register.
 * If the caller passes `target`, that register is used; otherwise a
 * fresh temporary is allocated.
 */

import { NODE } from '../parser/types.js';
import { OP } from './opcodes.js';
import { asConstRk, asRegisterRk } from './instruction.js';

/**
 * Compile an expression into R[target] (or allocate a fresh reg).
 * Returns the register number holding the result.
 */
export function compileExpr(C, node, target) {
  if (target === undefined || target === null) {
    target = C.scope.allocTemp();
    C.tempManaged.add(target);
  }
  compileInto(C, node, target);
  return target;
}

function compileInto(C, node, target) {
  switch (node.type) {
    case NODE.NIL:
      C.emit(OP.LOADNIL, target, 0, 0);
      return;

    case NODE.BOOL:
      C.emit(OP.LOADBOOL, target, node.value ? 1 : 0, 0);
      return;

    case NODE.NUMBER: {
      const k = C.constants.add(node.value);
      C.emit(OP.LOADK, target, k, 0);
      return;
    }

    case NODE.STRING: {
      const k = C.constants.add(node.value);
      C.emit(OP.LOADK, target, k, 0);
      return;
    }

    case NODE.IDENT: {
      const res = C.scope.resolve(node.name);
      if (res.kind === 'local') {
        if (res.register !== target) {
          C.emit(OP.MOVE, target, res.register, 0);
        }
      } else if (res.kind === 'upvalue') {
        C.emit(OP.GETUPVAL, target, res.index, 0);
      } else {
        const k = C.constants.add(node.name);
        C.emit(OP.GETGLOBAL, target, k, 0);
      }
      return;
    }

    case NODE.BINARY:
      compileBinary(C, node, target);
      return;

    case NODE.UNARY:
      compileUnary(C, node, target);
      return;

    case NODE.PAREN:
      compileInto(C, node.expression, target);
      return;

    case NODE.CALL:
      compileCall(C, node, target);
      return;

    case NODE.METHOD_CALL:
      compileMethodCall(C, node, target);
      return;

    case NODE.INDEX:
      compileIndex(C, node, target);
      return;

    case NODE.TABLE:
      compileTable(C, node, target);
      return;

    case NODE.FUNC_EXPR:
      compileFunctionExpr(C, node, target);
      return;

    case NODE.VARARG:
      C.emit(OP.LOADVARARG, target, 0, 0);
      return;

    default:
      throw new Error('Cannot compile expression: ' + node.type);
  }
}

function compileBinary(C, node, target) {
  // Handle and/or with short-circuit semantics
  if (node.operator === 'and' || node.operator === 'or') {
    compileAndOr(C, node, target);
    return;
  }

  const left = compileExpr(C, node.left);
  const right = compileExpr(C, node.right);

  const op = binaryOpcode(node.operator);
  if (op === null) {
    throw new Error('Unknown binary operator: ' + node.operator);
  }

  C.emit(op, target, asRegisterRk(left), asRegisterRk(right));
  C.freeTemp(left);
  C.freeTemp(right);
}

function compileAndOr(C, node, target) {
  const isAnd = node.operator === 'and';
  const left = compileExpr(C, node.left, target);
  C.emit(OP.TEST, left, isAnd ? 1 : 0, 0);
  const skip = C.emitJumpForward(OP.JMP);
  const right = compileExpr(C, node.right, target);
  C.patchHere(skip);
  C.freeTemp(right);
}

function binaryOpcode(op) {
  switch (op) {
    case '+': return OP.ADD;
    case '-': return OP.SUB;
    case '*': return OP.MUL;
    case '/': return OP.DIV;
    case '%': return OP.MOD;
    case '^': return OP.POW;
    case '..': return OP.CONCAT;
    case '==': return OP.EQ;
    case '~=': return OP.NE;
    case '<': return OP.LT;
    case '<=': return OP.LE;
    case '>': return OP.GT;
    case '>=': return OP.GE;
    default: return null;
  }
}

function compileUnary(C, node, target) {
  const operand = compileExpr(C, node.argument);
  let op;
  switch (node.operator) {
    case '-': op = OP.UNM; break;
    case 'not': op = OP.NOT; break;
    case '#': op = OP.LEN; break;
    default: throw new Error('Unknown unary operator: ' + node.operator);
  }
  C.emit(op, target, operand, 0);
  C.freeTemp(operand);
}

function compileCall(C, node, target) {
  // Compile callee into a register
  const callee = compileExpr(C, node.callee);

  // Compile arguments into consecutive registers right after callee
  const argStart = C.scope.nextRegister;
  for (const arg of node.args) {
    compileExpr(C, arg);
  }
  const nargs = node.args.length;

  C.emit(OP.CALL, callee, nargs, 2); // 2 = return 1 result

  if (callee !== target) {
    C.emit(OP.MOVE, target, callee, 0);
  }
  // Free argument registers + callee
  C.scope.nextRegister = argStart - 1;
}

function compileMethodCall(C, node, target) {
  // Compile object into a register
  const obj = compileExpr(C, node.object);

  // Place the method key in the next register
  const methodReg = C.scope.allocTemp();
  const k = C.constants.add(node.method);
  C.emit(OP.LOADK, methodReg, k, 0);

  // Get the method function
  const funcReg = C.scope.allocTemp();
  C.emit(OP.GETTABLE, funcReg, obj, asRegisterRk(methodReg));

  // Arguments go after the function register
  C.scope.allocTemp(); // reserve for self
  C.emit(OP.MOVE, C.scope.nextRegister - 1, obj, 0);

  const argStart = C.scope.nextRegister;
  for (const arg of node.args) {
    compileExpr(C, arg);
  }
  const nargs = node.args.length + 1; // +1 for self

  C.emit(OP.CALL, funcReg, nargs, 2);

  if (funcReg !== target) {
    C.emit(OP.MOVE, target, funcReg, 0);
  }

  C.scope.nextRegister = obj;
}

function compileIndex(C, node, target) {
  const obj = compileExpr(C, node.object);
  let key;
  let rk;

  if (!node.computed) {
    // .name  → constant key
    const k = C.constants.add(node.key.value);
    rk = asConstRk(k);
    key = null;
  } else {
    key = compileExpr(C, node.key);
    rk = asRegisterRk(key);
  }

  C.emit(OP.GETTABLE, target, obj, rk);
  C.freeTemp(obj);
  if (key !== null) C.freeTemp(key);
}

function compileTable(C, node, target) {
  // Count array fields and hash fields
  let arrayCount = 0;
  let hashCount = 0;
  for (const f of node.fields) {
    if (f.type === NODE.FIELD_ARRAY) arrayCount++;
    else hashCount++;
  }

  C.emit(OP.NEWTABLE, target, arrayCount, hashCount);

  let arrayIndex = 1;
  for (const f of node.fields) {
    if (f.type === NODE.FIELD_ARRAY) {
      const v = compileExpr(C, f.value);
      // SETTABLE: R[target][arrayIndex] = R[v]
      // For array part we use integer constant as key
      const kIdx = C.constants.add(arrayIndex);
      C.emit(OP.SETTABLE, target, asConstRk(kIdx), asRegisterRk(v));
      C.freeTemp(v);
      arrayIndex++;
    } else {
      const v = compileExpr(C, f.value);
      let keyRk;
      if (f.key.type === NODE.STRING) {
        const k = C.constants.add(f.key.value);
        keyRk = asConstRk(k);
      } else {
        const kReg = compileExpr(C, f.key);
        keyRk = asRegisterRk(kReg);
        C.freeTemp(kReg);
      }
      C.emit(OP.SETTABLE, target, keyRk, asRegisterRk(v));
      C.freeTemp(v);
    }
  }
}

function compileFunctionExpr(C, node, target) {
  // Compile the function body into a nested proto
  const proto = C.compileNestedFunction(node);
  const protoIdx = C.addProto(proto);
  C.emit(OP.CLOSURE, target, protoIdx, 0);
}

export default { compileExpr };