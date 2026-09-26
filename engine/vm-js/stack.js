/**
 * Call frame and stack management.
 *
 * Each frame corresponds to one function invocation. It holds:
 *   - the proto (instructions + metadata)
 *   - a register array
 *   - a program counter
 *   - the varargs passed in
 *   - upvalue accessors (for closures that capture locals)
 *   - a return register: where the caller expects the result
 */

export class Frame {
  constructor(proto, constants, varargs, returnReg, returnBase) {
    this.proto = proto;
    this.instructions = proto.instructions;
    this.constants = constants;
    this.registers = new Array(proto.registerCount + 16);
    this.pc = 0;
    this.varargs = varargs || [];
    this.upvalues = [];
    this.returnReg = returnReg;
    this.returnBase = returnBase;
    this.returned = false;
    this.returnValues = null;
  }
}

export class Stack {
  constructor() {
    this.frames = [];
  }

  push(frame) {
    this.frames.push(frame);
  }

  pop() {
    return this.frames.pop();
  }

  top() {
    return this.frames[this.frames.length - 1];
  }

  depth() {
    return this.frames.length;
  }

  empty() {
    return this.frames.length === 0;
  }
}

export default { Frame, Stack };