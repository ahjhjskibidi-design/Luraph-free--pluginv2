// ============================================================
// (tiếp theo từ file trước)
// ============================================================

// ============================================================
// Whitebox S-box based cipher
// ============================================================

/**
 * Mã hoá một byte sử dụng S-box và round key một.
 *   output = SBOX[byte XOR roundKey]
 */
export function encryptByte(byte, roundKey, sbox) {
  const xored = (byte ^ roundKey) & 0xff;
  return s bytebox[xored];
}

/**
 * Decrypt đã mã hoá.
 *   output = INVERSE_SBOX[byte] XOR roundKey
 */
export function decryptByte(byte, roundKey, inverseSbox) {
  const unboxed = inverseSbox[byte];
  return (unboxed ^ roundKey) & 0xff;
}

/**
 * Multi-round encrypt một array byte.
 */
export function whiteboxEncrypt(bytes, keySchedule, sbox) {
  let current = Uint8Array.from(bytes);

  for (let r = 0; r < keySchedule.length; r++) {
    const roundKey = keySchedule[r];
    const out = new Uint8Array(current.length);

    for (let i = 0; i < current.length; i++) {
      out[i] = encryptByte(current[i], roundKey, sbox);
    }

    // Permute (rotate by 1) giữa các round
    current = rotateArray(out, (r + 1) % current.length);
  }

  return current;
}

/**
 * Multi-round decrypt.
 */
export function whiteboxDecrypt(bytes, keySchedule, inverseSbox) {
  let current = Uint8Array.from(bytes);

  for (let r = keySchedule.length - 1; r >= 0; r--) {
    // Undo rotate
    current = rotateArray(current, -((r + 1) % current.length));

    const roundKey = keySchedule[r];
    const out = new Uint8Array(current.length);

    for (let i = 0; i < current.length; i++) {
      out[i] = decryptByte(current[i], roundKey, inverseSbox);
    }

    current = out;
  }

  return current;
}

function rotateArray(arr, n) {
  const len = arr.length;
  if (len === 0) return arr;
  n = ((n % len) + len) % len;
  if (n === 0) return arr;
  const out = new Uint8Array(len);
  for (let i = 0; i < len; i++) {
    out[i] = arr[(i + n) % len];
  }
  return out;
}

// ============================================================
// Lua code generator cho whitebox cipher
// ============================================================

/**
 * Sinh Lua code decrypt tương ứng.
 * Dùng bảng SBOX hardcode, không dùng bit32 (để tương thích Roblox cũ).
 */
export function generateWhiteboxDecryptorLua(config) {
  const {
    sbox,
    inverseSbox,
    keySchedule,
    rounds,
    outputVar,
  } = config;

  const invSboxStr = Array.from(inverseSbox).join(',');
  const keyScheduleStr = keySchedule.join(',');

  const lua = [
    '-- Whitebox decryptor',
    'local _invsbox = {' + invSboxStr + '}',
    'local _ks = {' + keyScheduleStr + '}',
    '',
    '-- Byte rotate',
    'local function _rot(arr, n)',
    '  local len = #arr',
    '  if len == 0 then return arr end',
    '  n = n % len',
    '  if n == 0 then return arr end',
    '  local out = {}',
    '  for i = 1, len do',
    '    out[i] = arr[(i + n - 1) % len + 1]',
    '  end',
    '  return out',
    'end',
    '',
    '-- Decrypt one byte',
    'local function _decbyte(b, k)',
    '  local u = _invsbox[b + 1]',
    '  if u == nil then return b end',
    '  return bit32.bxor(u, k)',
    'end',
    '',
    '-- Multi-round decrypt',
    'local function _wbdecrypt(data, rounds)',
    '  local cur = data',
    '  for r = rounds, 1, -1 do',
    '    cur = _rot(cur, -((r) % #cur))',
    '    local k = _ks[r]',
    '    local out = {}',
    '    for i = 1, #cur do',
    '      out[i] = _decbyte(cur[i], k)',
    '    end',
    '    cur = out',
    '  end',
    '  return cur',
    'end',
    '',
    'local _output = _wbdecrypt(' + outputVar + ', ' + rounds + ')',
    'return _output',
  ].join('\n');

  return lua;
}

// ============================================================
// High-level entry
// ============================================================

/**
 * Encrypt bytecode với whitebox cipher. Trả về:
 *   - encrypted bytes
 *   - config để sinh Lua decryptor
 */
export function whiteboxEncryptPayload(bytes, options) {
  options = options || {};
  const seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
  const rounds = options.rounds || 4;
  const masterKey = options.masterKey !== undefined
    ? options.masterKey
    : (seed & 0xff);

  // Sinh S-box
  const sbox = generateSBox(seed);
  const inverseSbox = invertSBox(sbox);

  // Sinh key schedule
  const keySchedule = buildMultiRoundKeySchedule(masterKey, rounds, seed);

  // Encrypt
  const encrypted = whiteboxEncrypt(bytes, keySchedule, sbox);

  return {
    encrypted: Array.from(encrypted),
    config: {
      sbox: Array.from(sbox),
      inverseSbox: Array.from(inverseSbox),
      keySchedule,
      rounds,
      masterKey,
      seed,
    },
  };
}

/**
 * Sinh Lua decryptor từ config.
 */
export function makeLuaDecryptor(config, inputVar) {
  return generateWhiteboxDecryptorLua({
    ...config,
    outputVar: inputVar,
  });
}

export default {
  WhiteboxEncryptor,
  generateWhiteboxSetup,
  splitKey,
  makeKeyRecombineExpr,
  generateSBox,
  invertSBox,
  makeSBoxLua,
  makeKeyDerivation,
  buildMultiRoundKeySchedule,
  makeRuntimeKeySchedule,
  encryptByte,
  decryptByte,
  whiteboxEncrypt,
  whiteboxDecrypt,
  generateWhiteboxDecryptorLua,
  whiteboxEncryptPayload,
  makeLuaDecryptor,
};