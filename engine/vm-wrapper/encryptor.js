/**
 * Encryptor — mã hoá bytecode trước khi nhúng vào output.
 *
 * Bytecode được:
 *   1. Serialize thành byte array (mỗi instruction 6 bytes)
 *   2. Chia thành fragments
 *   3. XOR từng fragment với key (chained)
 *   4. Thêm checksum mỗi fragment
 *   5. Trả về encrypted fragments + metadata
 *
 * VM Lua sẽ decrypt fragments khi chạy.
 */

export class BytecodeEncryptor {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.rounds = options.rounds || 3;
    this.fragmentSize = options.fragmentSize || 128; // bytes
    this.chained = options.chained !== false;
    this.rngState = (this.seed >>> 0) || 1;
  }

  nextByte() {
    let x = this.rngState;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.rngState = x >>> 0;
    return this.rngState & 0xff;
  }

  /**
   * Serialize một instruction (6 bytes) thành array.
   */
  serializeInstruction(inst) {
    return [inst[0] & 0xff, inst[1] & 0xff, inst[2] & 0xff,
            inst[3] & 0xff, inst[4] & 0xff, inst[5] & 0xff];
  }

  /**
   * Serialize toàn bộ proto thành byte array.
   */
  serializeProto(proto) {
    const bytes = [];
    for (const inst of proto.instructions) {
      bytes.push(...this.serializeInstruction(inst));
    }
    return bytes;
  }

  /**
   * Serialize toàn bộ program.
   */
  serializeProgram(program) {
    const mainBytes = this.serializeProto(program.main);
    const protoBytes = program.protos.map(p => this.serializeProto(p));
    return { mainBytes, protoBytes };
  }

  /**
   * XOR byte array với key array.
   */
  xorBytes(bytes, key) {
    const out = [];
    for (let i = 0; i < bytes.length; i++) {
      out.push(bytes[i] ^ key[i % key.length]);
    }
    return out;
  }

  /**
   * Sinh key schedule cho N fragment.
   * Chained: key[i] = f(key[i-1], seed, i)
   */
  makeKeySchedule(count) {
    const schedule = [];
    let prevHash = 0;

    for (let i = 0; i < count; i++) {
      const keyLen = 8 + this.nextByte() % 16;
      const key = [];
      for (let j = 0; j < keyLen; j++) {
        key.push(this.nextByte());
      }

      if (this.chained) {
        // Mix với prevHash
        for (let j = 0; j < key.length; j++) {
          key[j] = (key[j] ^ ((prevHash >> (j % 4) * 8) & 0xff)) & 0xff;
        }
      }

      // Tính hash mới từ encrypted (sẽ tính sau)
      prevHash = 0;
      for (const b of key) {
        prevHash = ((prevHash << 5) - prevHash + b) >>> 0;
      }

      schedule.push(key);
    }

    return schedule;
  }

  /**
   * Encrypt một fragment với nhiều rounds.
   */
  encryptFragment(bytes, key) {
    let current = bytes.slice();

    for (let r = 0; r < this.rounds; r++) {
      // XOR với key
      current = this.xorBytes(current, key);

      // Rotate left 1
      if (current.length > 0) {
        const first = current.shift();
        current.push(first);
      }
    }

    return current;
  }

  /**
   * Tính checksum đơn giản (sum mod 256).
   */
  checksum(bytes) {
    let sum = 0;
    for (const b of bytes) {
      sum = (sum + b) & 0xff;
    }
    return sum;
  }

  /**
   * Encrypt toàn bộ program.
   */
  encrypt(program) {
    const { mainBytes, protoBytes } = this.serializeProgram(program);

    // Tất cả proto bytes vào chung
    const allBytes = [...mainBytes];
    const protoOffsets = [{ offset: 0, length: mainBytes.length, kind: 'main' }];

    for (const pb of protoBytes) {
      protoOffsets.push({
        offset: allBytes.length,
        length: pb.length,
        kind: 'proto',
      });
      allBytes.push(...pb);
    }

    // Chia thành fragments
    const fragments = [];
    const fragCount = Math.ceil(allBytes.length / this.fragmentSize) || 1;

    for (let i = 0; i < fragCount; i++) {
      const start = i * this.fragmentSize;
      const end = Math.min(start + this.fragmentSize, allBytes.length);
      const fragBytes = allBytes.slice(start, end);
      fragments.push(fragBytes);
    }

    // Key schedule
    const keySchedule = this.makeKeySchedule(fragments.length);

    // Encrypt từng fragment
    const encryptedFragments = [];
    for (let i = 0; i < fragments.length; i++) {
      const enc = this.encryptFragment(fragments[i], keySchedule[i]);
      encryptedFragments.push({
        bytes: enc,
        checksum: this.checksum(enc),
      });
    }

    return {
      fragments: encryptedFragments,
      keySchedule,
      protoOffsets,
      totalBytes: allBytes.length,
      rounds: this.rounds,
      seed: this.seed,
    };
  }
}

// ============================================================
// Entry
// ============================================================

export function encryptProgram(program, options) {
  const enc = new BytecodeEncryptor(options);
  return enc.encrypt(program);
}

export default { BytecodeEncryptor, encryptProgram };