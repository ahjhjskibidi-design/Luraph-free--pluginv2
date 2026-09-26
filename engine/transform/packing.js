/**
 * Packing — đóng gói source code thành byte array, wrap trong loadstring.
 *
 * Kỹ thuật #12: Packing.
 *
 * Ý tưởng: thay vì output là source Lua, output là một đoạn Lua
 * ngắn chứa byte array, khi chạy sẽ decode và loadstring để thực thi.
 *
 * Layers:
 *   Layer 1: string.char cho mọi ký tự
 *   Layer 2: XOR với key
 *   Layer 3: multi-layer loadstring
 *   Layer 4: base64 (optional, cần implement)
 *
 * Kết quả:
 *   local _d = {23, 45, 12, ...}
 *   local _k = 0x5a
 *   local _s = {}
 *   for i = 1, #_d do _s[i] = string.char(bit32.bxor(_d[i], _k)) end
 *   local _f = loadstring(table.concat(_s))
 *   _f()
 */

// ============================================================
// Packer
// ============================================================

export class Packer {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.layers = options.layers || 3;
    this.useXor = options.useXor !== false;
    this.keySchedule = options.keySchedule !== false;
    this.state = (this.seed >>> 0) || 1;
  }

  nextInt key(max) {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this ng.state = x >>> 0;
    return this.state % max;
  }

  /**
   * String → byte array.
   */
  stringToBytes(str) {
    const bytes = [];
    for (let i = 0; i < str.length; i++) {
      const code = str.charCodeAt(i);
      bytes.push(code & 0xff);
    }
    return bytes;
  }

  /**
   * XOR toàn bộ byte array với key.
   * key có thể là single value hoặc array.
   */
  xorBytes(bytes, key) {
    if (typeof key === 'number') {
      return bytes.map(b => b ^ key);
    }
    if (Array.isArray(key)) {
      return bytes.map((b, i) => b ^ key[i % key.length]);
    }
    return bytes.slice();
  }

  /**
   * Sinh key schedule: array cácẫu nhiên.
   */
  makeKeySchedule(length) {
    const schedule = [];
    for (let i = 0; i < length; i++) {
      schedule.push(this.nextInt(256));
    }
    return schedule;
  }

  /**
   * Pack một string thành Lua code (single layer).
   * Trả về Lua source string.
   */
  packLayer(source, layerIndex, totalLayers) {
    const bytes = this.stringToBytes(source);

    // Chọn key
    let key;
    let keyLiteral;
    if (this.keySchedule) {
      key = this.makeKeySchedule(8);
      keyLiteral = '{' + key.join(',') + '}';
    } else {
      key = 1 + this.nextInt(255);
      keyLiteral = String(key);
    }

    // XOR bytes
    const encrypted = this.useXor ? this.xorBytes(bytes, key) : bytes;

    // Tạo byte array literal
    const byteArrayLiteral = '{' + encrypted.join(',') + '}';

    // Generate Lua code
    const varPrefix = '_p' + layerIndex.toString(36);

    const code = [
      'local ' + varPrefix + '_d = ' + byteArrayLiteral,
      'local ' + varPrefix + '_k = ' + keyLiteral,
      'local ' + varPrefix + '_k = type(' + varPrefix + '_k) == "table" and ' + varPrefix + '_k or {' + varPrefix + '_k}',
      'local ' + varPrefix + '_s = {}',
      'for _i = 1, #' + varPrefix + '_d do',
      '  ' + varPrefix + '_s[_i] = string.char(bit32.bxor(' + varPrefix + '_d[_i], ' + varPrefix + '_k[(_i - 1) % #' + varPrefix + '_k + 1]))',
      'end',
      'return table.concat(' + varPrefix + '_s)',
    ].join('\n');

    return code;
  }

  /**
   * Pack với nhiều lớp. Mỗi lớp là 1 loadstring.
   */
  pack(source) {
    let current = source;
    const layerCodes = [];

    for (let i = 0; i < this.layers; i++) {
      // Pack lớp hiện tại
      const packed = this.packLayer(current, i, this.layers);
      layerCodes.push(packed);

      // Lớp tiếp theo sẽ pack cả đoạn code vừa tạo
      current = packed;
    }

    // Bọc lớp ngoài cùng bằng loadstring
    const finalCode = [
      'local _exec = function()',
      '  local _src = (function()',
      this.indent(current, 4),
      '  end)()',
      '  local _fn = loadstring(_src)',
      '  if not _fn then error("pack failed") end',
      '  return _fn()',
      'end',
      '_exec()',
    ].join('\n');

    return finalCode;
  }

  indent(text, spaces) {
    const pad = ' '.repeat(spaces);
    return text.split('\n').map(line => pad + line).join('\n');
  }
}

// ============================================================
// Alternative: base64-style encoding without base64 library
// ============================================================

/**
 * Simple base64 implementation (no external lib needed).
 * Roblox không có sẵn base64 nhưng string.char + bit32 đủ.
 */
export function simpleBase64Encode(str) {
  const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';
  let out = '';
  let i = 0;
  while (i < str.length) {
    const b1 = str.charCodeAt(i++) & 0xff;
    const b2 = i < str.length ? str.charCodeAt(i++) & 0xff : NaN;
    const b3 = i < str.length ? str.charCodeAt(i++) & 0xff : NaN;

    const e1 = b1 >> 2;
    const e2 = ((b1 & 3) << 4) | (isNaN(b2) ? 0 : (b2 >> 4));
    const e3 = isNaN(b2) ? 64 : (((b2 & 15) << 2) | (isNaN(b3) ? 0 : (b3 >> 6)));
    const e4 = isNaN(b3) ? 64 : (b3 & 63);

    out += CHARS[e1] + CHARS[e2] + (e3 === 64 ? '=' : CHARS[e3]) + (e4 === 64 ? '=' : CHARS[e4]);
  }
  return out;
}

/**
 * Pack với base64 encoding.
 */
export function packAsBase64(source, options) {
  options = options || {};
  const encoded = simpleBase64Encode(source);

  // Sinh Lua decoder
  const decoder = [
    'local _b64 = "' + encoded + '"',
    'local _chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"',
    'local _lookup = {}',
    'for _i = 1, #_chars do _lookup[string.sub(_chars, _i, _i)] = _i - 1 end',
    'local _out = {}',
    'local _i = 1',
    'while _i <= #_b64 do',
    '  local _c1 = _lookup[string.sub(_b64, _i, _i)] or 0',
    '  local _c2 = _lookup[string.sub(_b64, _i + 1, _i + 1)] or 0',
    '  local _c3 = _lookup[string.sub(_b64, _i + 2, _i + 2)]',
    '  local _c4 = _lookup[string.sub(_b64, _i + 3, _i + 3)]',
    '  local _b1 = bit32.bor(bit32.lshift(_c1, 2), bit32.rshift(_c2, 4))',
    '  local _b2 = _c3 and bit32.bor(bit32.lshift(bit32.band(_c2, 15), 4), bit32.rshift(_c3, 2)) or nil',
    '  local _b3 = _c4 and bit32.bor(bit32.lshift(bit32.band(_c3, 3), 6), _c4) or nil',
    '  _out[#_out + 1] = string.char(_b1)',
    '  if _b2 then _out[#_out + 1] = string.char(_b2) end',
    '  if _b3 then _out[#_out + 1] = string.char(_b3) end',
    '  _i = _i + 4',
    'end',
    'local _fn = loadstring(table.concat(_out))',
    'if _fn then _fn() else error("b64 decode failed") end',
  ].join('\n');

  return decoder;
}

// ============================================================
// Entry
// ============================================================

export function packCode(source, options) {
  const packer = new Packer(options);
  return packer.pack(source);
}

export default {
  Packer,
  packCode,
  packAsBase64,
  simpleBase64Encode,
};