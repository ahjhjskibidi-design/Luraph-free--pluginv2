/**
 * Instruction decode helpers.
 *
 * An instruction is a 32-bit integer packed as:
 *   [opcode:8][A:8][B:8][C:8]
 *
 * RK operands: for opcodes that accept either a register or a constant
 * pool index, the top bit of the operand selects. 0 = register,
 * 1 = constant. Registers then max at 127 for those operands.
 */

const MASK_8 = 0xff;
const MASK_RK = 0x7f;
const RK_CONST = 0x80;

export function decode(word) {
  return {
    op: (word >>> 24) & MASK_8,
    a: (word >>> 16) & MASK_8,
    b: (word >>> 8) & MASK_8,
    c: word & MASK_8,
  };
}

export function rkIsConst(rk) {
  return (rk & RK_CONST) !== 0;
}

export function rkIndex(rk) {
  return rk & MASK_RK;
}

/**
 * Decode a signed 16-bit jump offset from B and C bytes.
 */
export function decodeJump(b, c) {
  let signed = ((b & MASK_8) << 8) | (c & MASK_8);
  if (signed >= 0x8000) signed -= 0x10000;
  return signed;
}

/**
 * Resolve an RK operand to its value.
 */
export function rkValue(registers, constants, rk) {
  if (rkIsConst(rk)) {
    return constants[rkIndex(rk)];
  }
  return registers[rkIndex(rk)];
}

export default {
  decode,
  rkIsConst,
  rkIndex,
  decodeJump,
  rkValue,
};