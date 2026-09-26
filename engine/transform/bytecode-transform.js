/**
 * Bytecode Transformer — biến đổi standard bytecode thành custom
 * bytecode khó dịch ngược.
 *
 * Đầu vào: bytecode từ engine/compiler (dạng { op, a, b, c })
 * Đầu ra: custom bytecode (dạng { o, r1, r2, r3 } với o là opcode
 * đã đổi tên, r1/r2/r3 là register hoặc constant index đã shuffle)
 *
 * Kỹ thuật:
 *   1. Opcode name randomization — mỗi lần build một mapping mới
 *   2. Register renumbering — đổi số register trong mọi instruction
 *   3. Constant pool shuffle — đổi thứ tự constants
 *   4. Dead instruction injection — chèn instruction không chạy
 *   5. Opaque predicates — chèn jump luôn-true hoặc luôn-false
 *   6. Instruction fission — chia 1 instruction thành nhiều
 *   7. Fragment splitting — chia thành các đoạn nhỏ
 */

import { OP, OP_NAME } from '../vm2/opcodes.js';

// ============================================================
// Cấu hình
// ============================================================

const DEFAULT_OPTIONS = {
  // Đổi tên opcode (mỗi lần build khác)
  randomizeOpcodes: true,

  // Đổi số register
  renumberRegisters: true,
  registerOffset: 32, // chừa 32 slot đầu cho VM dùng

  // Đổi thứ tự constants
  shuffleConstants: true,

  // Chèn dead instruction
  deadInstructionRatio: 0.3, // 30% số instruction gốc

  // Opaque predicates
  insertOpaquePredicates: true,
  opaquePredicateRatio: 0.05, // 5% số jump

  // Fragment splitting
  fragmentSize: 32, // số instruction mỗi đoạn

  // Instruction fission (chia 1 thành nhiều)
  enableFission: true,
  fissionRatio: 0.1, // 10% instruction bị chia

  // Seed (để tái tạo kết quả)
  seed: null,
};

// ============================================================
// Random generator (deterministic nếu có seed)
// ============================================================

class Random {
  constructor(seed) {
    if (seed === null || seed === undefined) {
      seed = Date.now() ^ (Math.random() * 0x7fffffff);
    }
    this.state = (seed >>> 0) || 1;
  }

  next() {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state;
  }

  nextInt(max) {
    return this.next() % max;
  }

  nextFloat() {
    return this.next() / 0x100000000;
  }

  pick(arr) {
    return arr[this.nextInt(arr.length)];
  }

  shuffle(arr) {
    const out = arr.slice();
    for (let i = out.length - 1; i > 0; i--) {
      const j = this.nextInt(i + 1);
      [out[i], out[j]] = [out[j], out[i]];
    }
    return out;
  }
}

// ============================================================
// Opcode renaming
// ============================================================

/**
 * Tạo bảng mapping opcode gốc → opcode mới.
 * Mỗi lần gọi tạo mapping khác.
 */
function buildOpcodeMapping(random) {
  const originalOps = Object.values(OP).filter(v => typeof v === 'number');
  const newOps = random.shuffle(originalOps);

  const mapping = {};
  const reverse = {};

  for (let i = 0; i < originalOps.length; i++) {
    mapping[originalOps[i]] = newOps[i];
    reverse[newOps[i]] = originalOps[i];
  }

  return { mapping, reverse };
}

/**
 * Áp mapping vào một instruction.
 */
function applyOpcodeMapping(inst, mapping) {
  const newOp = mapping[inst.op];
  if (newOp === undefined) {
    throw new Error('Không có mapping cho opcode 0x' + inst.op.toString(16));
  }
  return { ...inst, op: newOp };
}

// ============================================================
// Register renumbering
// ============================================================

/**
 * Đổi số register trong mọi instruction.
 * Chỉ đổi register operand (không đổi RK constant).
 */
function buildRegisterMapping(proto, random, offset) {
  const maxReg = proto.registerCount || 256;
  const newNumbers = [];

  // Chừa offset slot đầu
  const available = [];
  for (let i = offset; i < offset + maxReg; i++) available.push(i);

  const shuffled = random.shuffle(available);

  const mapping = {};
  for (let i = 0; i < maxReg; i++) {
    mapping[i] = shuffled[i];
  }

  return mapping;
}

/**
 * Đổi số register trong instruction, giữ RK flag nguyên vẹn.
 */
function applyRegisterMapping(inst, mapping) {
  const isRK = (v) => (v & 0x80) !== 0;
  const rkIndex = (v) => v & 0x7f;
  const toRK = (v, isConst) => (isConst ? (v | 0x80) : (v & 0x7f));

  const newInst = { ...inst };

  // A luôn là register (không phải RK)
  if (mapping[inst.a] !== undefined) {
    newInst.a = mapping[inst.a];
  }

  // B có thể là register hoặc RK
  if (isRK(inst.b)) {
    // Là constant — giữ nguyên index (sẽ được shuffle riêng)
  } else {
    if (mapping[inst.b] !== undefined) {
      newInst.b = mapping[inst.b] & 0x7f;
    }
  }

  // C tương tự
  if (isRK(inst.c)) {
    // Là constant — giữ nguyên
  } else {
    if (mapping[inst.c] !== undefined) {
      newInst.c = mapping[inst.c] & 0x7f;
    }
  }

  return newInst;
}

// ============================================================
// Constant pool shuffle
// ============================================================

/**
 * Xáo trộn thứ tự constants. Trả về mapping index cũ → index mới.
 */
function shuffleConstants(constants, random) {
  const indexed = constants.map((c, i) => ({ c, i }));
  const shuffled = random.shuffle(indexed);

  const newConstants = new Array(constants.length);
  const indexMapping = {};

  for (let newIdx = 0; newIdx < shuffled.length; newIdx++) {
    const { c, i: oldIdx } = shuffled[newIdx];
    newConstants[newIdx] = c;
    indexMapping[oldIdx] = newIdx;
  }

  return { newConstants, indexMapping };
}

/**
 * Áp mapping constant vào instruction (RK operand).
 */
function applyConstantMapping(inst, mapping) {
  const isRK = (v) => (v & 0x80) !== 0;
  const rkIndex = (v) => v & 0x7f;
  const toRK = (v) => (v | 0x80);

  const newInst = { ...inst };

  if (isRK(inst.b)) {
    const oldIdx = rkIndex(inst.b);
    if (mapping[oldIdx] !== undefined) {
      newInst.b = toRK(mapping[oldIdx]);
    }
  }

  if (isRK(inst.c)) {
    const oldIdx = rkIndex(inst.c);
    if (mapping[oldIdx] !== undefined) {
      newInst.c = toRK(mapping[oldIdx]);
    }
  }

  return newInst;
}

// ============================================================
// Dead instruction injection
// ============================================================

/**
 * Tạo một instruction chết (không bao giờ chạy).
 * Dùng opcode thật nhưng operand vô nghĩa.
 */
function makeDeadInstruction(random, opcodes) {
  const op = random.pick(opcodes);
  return {
    op,
    a: random.nextInt(64),
    b: random.nextInt(64),
    c: random.nextInt(64),
    dead: true,
  };
}

/**
 * Chèn dead instruction vào stream, xen kẽ với instruction thật.
 */
function injectDeadInstructions(instructions, random, ratio, opcodes) {
  const out = [];
  const deadCount = Math.floor(instructions.length * ratio);

  // Tạo danh sách dead instructions
  const dead = [];
  for (let i = 0; i < deadCount; i++) {
    dead.push(makeDeadInstruction(random, opcodes));
  }

  // Trộn dead và thật
  let deadIdx = 0;
  for (const inst of instructions) {
    out.push(inst);

    // Đôi khi chèn dead sau instruction thật
    if (deadIdx < dead.length && random.nextFloat() < 0.5) {
      out.push(dead[deadIdx++]);
    }
  }

  // Nếu còn dead, chèn vào cuối
  while (deadIdx < dead.length) {
    out.push(dead[deadIdx++]);
  }

  return out;
}

// ============================================================
// Opaque predicates
// ============================================================

/**
 * Chèn opaque predicate — một cặp instruction tạo điều kiện luôn đúng
 * hoặc luôn sai, dùng để che jump thật.
 *
 * Ví dụ: `if x * 0 + 1 == 1 then` — luôn đúng.
 *
 * Trong bytecode:
 *   LOADK R[a], K[x]        ; load x
 *   LOADK R[b], K[0]        ; load 0
 *   MUL   R[a], R[a], R[b]  ; x * 0 = 0
 *   LOADK R[b], K[1]        ; load 1
 *   ADD   R[a], R[a], R[b]  ; 0 + 1 = 1
 *   LOADK R[b], K[1]        ; load 1
 *   EQ    R[a], R[b]        ; 1 == 1 → true (bỏ qua jump tiếp)
 *
 * Sau đó jump thật sẽ bị đảo điều kiện.
 */
function makeOpaquePredicate(random, registerBase, constantBase) {
  return [
    { op: OP.LOADK, a: registerBase + 0, b: constantBase + 0, c: 0 },
    { op: OP.LOADK, a: registerBase + 1, b: constantBase + 1, c: 0 },
    { op: OP.MUL, a: registerBase + 0, b: registerBase + 0, c: registerBase + 1 },
    { op: OP.LOADK, a: registerBase + 1, b: constantBase + 2, c: 0 },
    { op: OP.ADD, a: registerBase + 0, b: registerBase + 0, c: registerBase + 1 },
    { op: OP.LOADK, a: registerBase + 1, b: constantBase + 2, c: 0 },
    { op: OP.EQ, a: 0, b: registerBase + 0, c: registerBase + 1 },
    // EQ với A=0 nghĩa là "if equal then skip next"
    // tiếp theo sẽ là instruction gốc
  ];
}

/**
 * Bao quanh một jump instruction bằng opaque predicate.
 */
function wrapJumpWithOpaque(jumpInst, random, registerBase, constantBase) {
  const opaque = makeOpaquePredicate(random, registerBase, constantBase);
  // Đảo điều kiện jump để bù cho opaque predicate
  const inverted = invertJump(jumpInst);
  return [...opaque, inverted];
}

function invertJump(inst) {
  // Đảo A của EQ/NE/LT/LE/GT/GE
  const jumplike = [OP.EQ, OP.NE, OP.LT, OP.LE, OP.GT, OP.GE];
  if (jumplike.includes(inst.op)) {
    return { ...inst, a: inst.a === 0 ? 1 : 0 };
  }
  return inst;
}

// ============================================================
// Instruction fission
// ============================================================

/**
 * Chia một instruction phức tạp thành nhiều instruction đơn giản.
 * Ví dụ: `ADD R1, R2, R3` → `MOVE R4, R2; ADD R1, R4, R3`
 * Chỉ áp dụng cho một số opcode.
 */
function fissionInstruction(inst, random, tempReg) {
  const fissions = [];

  // ADD, SUB, MUL, DIV, MOD, POW
  const arithOps = [OP.ADD, OP.SUB, OP.MUL, OP.DIV, OP.MOD, OP.POW];
  if (arithOps.includes(inst.op)) {
    // Chuyển operand B qua temp trước
    fissions.push({ op: OP.MOVE, a: tempReg, b: inst.b, c: 0 });
    return [...fissions, { ...inst, b: tempReg }];
  }

  // CONCAT
  if (inst.op === OP.CONCAT) {
    return [inst]; // không chia được
  }

  return [inst];
}

// ============================================================
// Fragment splitting
// ============================================================

/**
 * Chia instruction stream thành các fragment.
 * Mỗi fragment là một mảng instruction.
 */
function splitFragments(instructions, fragmentSize) {
  const fragments = [];
  for (let i = 0; i < instructions.length; i += fragmentSize) {
    fragments.push({
      index: fragments.length,
      startPC: i,
      instructions: instructions.slice(i, i + fragmentSize),
    });
  }
  return fragments;
}

// ============================================================
// Main transform
// ============================================================

/**
 * Biến đổi một proto.
 */
function transformProto(proto, random, opcodeMapping, options) {
  const opcodes = Object.values(OP).filter(v => typeof v === 'number');

  // 1. Shuffle constants
  let constants = proto.constants || [];
  let constantMapping = null;
  if (options.shuffleConstants && constants.length > 0) {
    const result = shuffleConstants(constants, random);
    constants = result.newConstants;
    constantMapping = result.indexMapping;
  }

  // 2. Register mapping
  const registerMapping = options.renumberRegisters
    ? buildRegisterMapping(proto, random, options.registerOffset)
    : null;

  // 3. Decode instruction (giả sử proto.instructions là Uint32 array
  //    hoặc mảng số nguyên)
  let instructions = decodeInstructions(proto.instructions);

  // 4. Apply opcode mapping
  if (options.randomizeOpcodes && opcodeMapping) {
    instructions = instructions.map(i => applyOpcodeMapping(i, opcodeMapping.mapping));
  }

  // 5. Apply register mapping
  if (registerMapping) {
    instructions = instructions.map(i => applyRegisterMapping(i, registerMapping));
  }

  // 6. Apply constant mapping
  if (constantMapping) {
    instructions = instructions.map(i => applyConstantMapping(i, constantMapping));
  }

  // 7. Inject dead instructions
  if (options.deadInstructionRatio > 0) {
    instructions = injectDeadInstructions(
      instructions,
      random,
      options.deadInstructionRatio,
      opcodes,
    );
  }

  // 8. Opaque predicates
  if (options.insertOpaquePredicates) {
    instructions = instructions.map(i => {
      if (i.op === OP.JMP && random.nextFloat() < options.opaquePredicateRatio) {
        return wrapJumpWithOpaque(i, random, 200, 100);
      }
      return i;
    }).flat();
  }

  // 9. Fragment splitting
  const fragments = splitFragments(instructions, options.fragmentSize);

  return {
    ...proto,
    instructions, // mảng instruction đã transform (dạng object)
    fragments, // chia nhỏ để encrypt riêng
    constants,
    registerCount: proto.registerCount + options.registerOffset,
  };
}

/**
 * Decode instruction words (Uint32) thành object.
 * Nếu proto.instructions đã là object array, giữ nguyên.
 */
function decodeInstructions(instructions) {
  if (!instructions || instructions.length === 0) return [];

  // Nếu phần tử đầu là số → decode từ Uint32
  if (typeof instructions[0] === 'number') {
    return instructions.map(word => ({
      op: (word >>> 24) & 0xff,
      a: (word >>> 16) & 0xff,
      b: (word >>> 8) & 0xff,
      c: word & 0xff,
    }));
  }

  // Nếu đã là object array → giữ nguyên
  return instructions;
}

// ============================================================
// Entry
// ============================================================

/**
 * Biến đổi toàn bộ program.
 */
export function transformBytecode(program, options) {
  options = { ...DEFAULT_OPTIONS, ...options };

  const random = new Random(options.seed);
  const opcode2Mapping = options.randomizeOpcodes ? buildOpcodeMapping(random) : null;

  const transformedMain = transformProto(program.main, random, opcodeMapping, options);
  const,
 transformedProtos = program.protos.map(p =>
    transformProto(p, random, opcodeMapping, options)
  );

  return {
    version:     opcodeMapping: opcodeMapping ? opcodeMapping.mapping : null,
    reverseMapping: opcodeMapping ? opcodeMapping.reverse : null,
    constants: program.constants,
    protos: transformedProtos,
    main: transformedMain,
    options: {
      registerOffset: options.registerOffset,
      fragmentSize: options.fragmentSize,
    },
  };
}

export default { transformBytecode };