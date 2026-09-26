/**
 * Opcode constants for the VM.
 * Must match engine/compiler/opcodes.js exactly.
 * Any drift is a silent failure — the VM will execute garbage.
 */

export const OP = {
  LOADK:       0x01,
  LOADNIL:     0x02,
  LOADBOOL:    0x03,
  LOADVARARG:  0x04,

  MOVE:        0x10,

  GETGLOBAL:   0x20,
  SETGLOBAL:   0x21,

  NEWTABLE:    0x30,
  GETTABLE:    0x31,
  SETTABLE:    0x32,

  ADD:         0x40,
  SUB:         0x41,
  MUL:         0x42,
  DIV:         0x43,
  MOD:         0x44,
  POW:         0x45,
  UNM:         0x46,
  BAND:        0x47,
  BOR:         0x48,
  BXOR:        0x49,
  BNOT:        0x4a,
  SHL:         0x4b,
  SHR:         0x4c,

  EQ:          0x50,
  NE:          0x51,
  LT:          0x52,
  LE:          0x53,
  GT:          0x54,
  GE:          0x55,

  NOT:         0x60,
  LEN:         0x61,
  CONCAT:      0x62,

  CLOSURE:     0x70,
  CALL:        0x71,
  TAILCALL:    0x72,
  RETURN:      0x73,

  JMP:         0x80,
  TEST:        0x81,

  GETUPVAL:    0x90,
  SETUPVAL:    0x91,

  HALT:        0xff,
};

export const OP_NAME = {};
for (const [name, code] of Object.entries(OP)) {
  OP_NAME[code] = name;
}

export default { OP, OP_NAME };