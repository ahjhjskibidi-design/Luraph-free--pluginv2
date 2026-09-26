/**
 * Bytecode Encryption — mã hóa bytecode với key schedule phức tạp.
 *
 * Kỹ thuật #11: Bytecode Encryption.
 *
 * Trong khi Packing chỉ XOR đơn giản, Bytecode Encryption dùng:
 *   - Multi-round encryption (nhiều vòng XOR + rotate)
 *   - Chained keys (key sau phụ thuộc key trước)
 *   - Per-fragment keys (mỗi đoạn có key riêng)
 *   - Key derivation từ seed + runtime state
 *   - Padding để che kích thước thật
 *
 * Áp dụng cho:
 *   1. Source code packed (byte array)
 *   2. Bytecode từ VM compiler (nếu có)
 *   3. Constants pool
 *   4. String table
 *
 * Thuật toán chính: XTEA-like hoặc đơn giản là multi-round XOR với
 * bit rotation.
 */

// ============================================================
// Crypto primitives
// ============================================================

/**
 * Xorshift32 PRNG.
 */
class XorShift32 {
  constructor(seed) {
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

  nextByte() {
    return this.next() & 0xff;
  }
}

/**
 * Rotate byte array trái n vị trí.
 */
function rotateBytes(bytes, n) {
  if (bytes.length === 0) return bytes;
  n = ((n % bytes.length) + bytes.length) % bytes.length;
  if (n === 0) return bytes.slice();
  return bytes.slice(n).concat(bytes.slice(0, n));
}

/**
 * XOR byte array với key.
 */
function xorBytes(bytes, key) {
  const out = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    out[i] = bytes[i] ^ key[i % key.length];
  }
  return out;
}

/**
 * Multi-round XOR encryption.
 */
function multiRoundXor(bytes, seed, rounds) {
  let current = Uint8Array.from(bytes);
  const rng = new XorShift32(seed);

  for (let r = 0; r < rounds; r++) {
    // Sinh key cho round này
    const keyLen = 8 + rng.next() % 24;
    const key = new Uint8Array(keyLen);
    for (let i = 0; i < keyLen; i++) {
      key[i] = rng.nextByte();
    }

    // XOR
    current = xorBytes(current, key);

    // Rotate
    const rot = rng.next() % current.length;
    current = Uint8Array.from(rotateBytes(current, rot));
  }

  return current;
}

// ============================================================
// Bytecode Encryptor
// ============================================================

export class BytecodeEncryptor {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.rounds = options.rounds || 3;
    this.fragmentSize = options.fragmentSize || 64;
    this.chainedKeys = options.chainedKeys !== false;
    this.padding = options.padding !== false;
    this.rng = new XorShift32(this.seed);
  }

  /**
   * Encrypt một byte array.
   * Trả về object chứa encrypted bytes + metadata để decrypt.
   */
  encrypt(bytes) {
    // Padding để che kích thước thật
    let data = Uint8Array.from(bytes);
    if (this.padding) {
      const padLen = (4 - (data.length % 4)) % 4;
      const pad = new Uint8Array(padLen + 4);
      // Ghi độ dài gốc vào 4 byte đầu
      pad[0] = (bytes.length >>> 24) & 0xff;
      pad[1] = (bytes.length >>> 16) & 0xff;
      pad[2] = (bytes.length >>> 8) & 0xff;
      pad[3] = bytes.length & 0xff;
      // Pad ngẫu nhiên
      for (let i = 4; i < pad.length; i++) {
        pad[i] = this.rng.nextByte();
      }
      const padded = new Uint8Array(pad.length + data.length);
      padded.set(pad, 0);
      padded.set(data, pad.length);
      data = padded;
    }

    // Multi-round XOR
    const encrypted = multiRoundXor(data, this.seed, this.rounds);

    return {
      bytes: Array.from(encrypted),
      seed: this.seed,
      rounds: this.rounds,
      originalLength: bytes.length,
      padded: this.padding,
    };
  }

  /**
   * Encrypt với fragmentation: chia bytecode thành nhiều đoạn,
   * mỗi đoạn có key riêng.
   */
  encryptFragmented(bytes) {
    const fragments = [];
    const totalLen = bytes.length;
    const fragSize = this.fragmentSize;
    const fragCount = Math.ceil(totalLen / fragSize);

    // Chained keys: key sau phụ thuộc key trước
    let previousKeyHash = 0;

    for (let i = 0; i < fragCount; i++) {
      const start = i * fragSize;
      const end = Math.min(start + fragSize, totalLen);
      const fragment = bytes.slice(start, end);

      // Key cho fragment này
      let fragSeed;
      if (this.chainedKeys) {
        fragSeed = (this.seed ^ previousKeyHash ^ (i * 0x9e3779b9)) >>> 0;
      } else {
        fragSeed = (this.seed + i * 12345) >>> 0;
      }

      // Encrypt fragment
      const fragRng = new XorShift32(fragSeed);
      const encrypted = multiRoundXor(fragment, fragSeed, this.rounds);

      // Hash cho chaining
      previousKeyHash = 0;
      for (const b of encrypted) {
        previousKeyHash = ((previousKeyHash << 5) - previousKeyHash + b) >>> 0;
      }

      fragments.push({
        index: i,
        seed: fragSeed,
        bytes: Array.from(encrypted),
      });
    }

    return {
      fragments,
      seed: this.seed,
      rounds: this.rounds,
      totalLength: totalLen,
      chained: this.chainedKeys,
    };
  }
}

// ============================================================
// Lua decryptor generator
// ============================================================

/**
 * Sinh Lua code để decrypt fragments và chạy.
 */
export function generateDecryptor(fragmented, options) {
  options = options || {};
  const fragments = fragmented.fragments;
  const rounds = fragmented.rounds;

  // Lua code structure:
  //   - Khai báo fragment seeds và bytes
  //   - Hàm decrypt(frag) chạy multi-round
  //   - Hàm rotate, xor
  //   - Decrypt từng fragment
  //   - Concat và loadstring
  //   - Execute

  const fragDecls = fragments.map((f, i) => {
    return 'frags[' + (i + 1) + '] = {seed = ' + f.seed + ', bytes = {' + f.bytes.join(',') + '}}';
  }).join('\n');

  const code = [
    '-- Bytecode decryptor (auto-generated)',
    'local frags = {}',
    fragDecls,
    '',
    '-- Xorshift32',
    'local function xorshift32(state)',
    '  state = bit32.bxor(state, bit32.lshift(state, 13))',
    '  state = bit32.bxor(state, bit32.rshift(state, 17))',
    '  state = bit32.bxor(state, bit32.lshift(state, 5))',
    '  return bit32.band(state, 0xffffffff)',
    'end',
    '',
    '-- Rotate bytes',
    'local function rotate(arr, n)',
    '  local len = #arr',
    '  if len == 0 then return arr end',
    '  n = n % len',
    '  if n == 0 then return arr end',
    '  local out = {}',
    '  for i = 1, len do',
    '    local src = ((i + n - 1) % len) + 1',
    '    out[i] = arr[src]',
    '  end',
    '  return out',
    'end',
    '',
    '-- Multi-round XOR',
    'local function decrypt(data, seed, rounds)',
    '  local current = data',
    '  local state = seed',
    '  for r = 1, rounds do',
    '    state = xorshift32(state)',
    '    local keyLen = 8 + (state % 24)',
    '    local key = {}',
    '    for i = 1, keyLen do',
    '      state = xorshift32(state)',
    '      key[i] = state % 256',
    '    end',
    '    local xored = {}',
    '    for i = 1, #current do',
    '      xored[i] = bit32.bxor(current[i], key[((i - 1) % #key) + 1])',
    '    end',
    '    state = xorshift32(state)',
    '    local rot = state % #xored',
    '    current = rotate(xored, -rot)',
    '  end',
    '  return current',
    'end',
    '',
    '-- Decrypt all fragments',
    'local allBytes = {}',
    'for i = 1, #frags do',
    '  local f = frags[i]',
    '  local dec = decrypt(f.bytes, f.seed, ' + rounds + ')',
    '  for j = 1, #dec do',
    '    allBytes[#allBytes + 1] = dec[j]',
    '  end',
    'end',
    '',
    '-- Unpad',
    'local padLen = allBytes[1] * 16777216 + allBytes[2] * 65536 + allBytes[3] * 256 + allBytes[4]',
    'local out = {}',
    'for i = 5, 5 + padLen - 1 do',
    '  out[#out + 1] = string.char(allBytes[i])',
    'end',
    '',
    '-- Execute',
    'local src = table.concat(out)',
    'local fn = loadstring(src)',
    'if not fn then error("decrypt failed") end',
    'fn()',
  ].join('\n');

  return code;
}

// ============================================================
// Entry
// ============================================================

export function encryptBytecode(bytes, options) {
  const encryptor = new BytecodeEncryptor(options);
  return encryptor.encryptFragmented(bytes);
}

export default {
  BytecodeEncryptor,
  encryptBytecode,
  generateDecryptor,
  multiRoundXor,
};