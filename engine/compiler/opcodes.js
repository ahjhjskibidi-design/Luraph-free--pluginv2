/**
 * Opcode definitions for the Lua Obf VM.
 *
 * Each opcode is 8 bits. The instruction word is 32 bits:
 *   [opcode:8][A:8][B:8][C:8]
 *
 * Register-based (like real Lua). A, B, C can be register numbers
 * (0-255) or constant pool indices depending on the opcode.
 *
 * RK convention: for opcodes that accept either a register or a
 * constant (arithmetic, comparison, table access), the top bit of
 * B or C indicates the source. 0 = register, 1 = constant. This is
 * why register numbers max out at 127 for RK operands.
 */

export const OP = {
  // Load
  LOADK:       0x01,  // R[A] = K[B]
  LOADNIL:     0x02,  // R[A] = nil (C registers from A to A+C)
  LOADBOOL:    0x03,  // R[A] = (B ? true : false); C = skip next if C
  LOADVARARG:  0x04,  // R[A] = vararg[C] (C=0: all)

  // Move
  MOVE:        0x10,  // R[A] = R[B]

  // Globals
  GETGLOBAL:   0x20,  // R[A] = _G[K[B]]
  SETGLOBAL:   0x21,  // _G[K[B]] = R[A]

  // Tables
  NEWTABLE:    0x30,  // R[A] = {} (B = array hint, C = hash hint)
  GETTABLE:    0x31,  // R[A] = R[B][RK[C]]
  SETTABLE:    0x32,  // R[A][RK[B]] = RK[C]

  // Arithmetic
  ADD:         0x40,  // R[A] = RK[B] + RK[C]
  SUB:         0x41,
  MUL:         0x42,
  DIV:         0x43,
  MOD:         0x44,
  POW:         0x45,
  UNM:         0x46,  // R[A] = -R[B]
  BAND:        0x47,
  BOR:         0x48,
  BXOR:        0x49,
  BNOT:        0x4a,
  SHL:         0x4b,
  SHR:         0x4c,

  // Compare
  EQ:          0x50,  // if (RK[B] == RK[C]) != A then pc++
  NE:          0x51,
  LT:          0x52,
  LE:          0x53,
  GT:          0x54,
  GE:          0x55,

  // Unary
  NOT:         0x60,  // R[A] = not R[B]
  LEN:         0x61,  // R[A] = #R[B]

  // Concat
  CONCAT:      0x62,  // R[A] = R[B] .. R[B+1] .. ... .. R[C]

  // Functions
  CLOSURE:     0x70,  // R[A] = closure(proto[B])
  CALL:        0x71,  // R[A] = R[A](R[A+1..A+B-1]); returns C-1 values
  TAILCALL:    0x72,
  RETURN:      0x73,  // return R[A..A+B-2]

  // Control
  JMP:         0x80,  // pc += sBx (signed B+C)
  TEST:        0x81,  // if (R[A] == (B ? true : false)) then pc++

  // Upvalues
  GETUPVAL:    0x90,  // R[A] = Upval[B]
  SETUPVAL:    0x91,  // Upval[B] = R[A]

  // Halt
  HALT:        0xff,
};

/**
 * Reverse lookup: opcode number → name.
 */
export const OP_NAME = {};
for (const [name, code] of Object.entries(OP)) {
  OP_NAME[code] = name;
}

/**
 * Does the opcode take RK operands (register or constant)?
 */
export function usesRK(op) {
  return [
    OP.ADD, OP.SUB, OP.MUL, OP.DIV, OP.MOD, OP.POW,
    OP.BAND, OP.BOR, OP.BXOR, OP.SHL, OP.SHR,
    OP.EQ, OP.NE, OP.LT, OP.LE, OP.GT, OP.GE,
    OP.GETTER, OP.SETTABLE, OP.GETTABLE,
  ].includes(op);
}

export default { OP, OP_NAME, usesRK };