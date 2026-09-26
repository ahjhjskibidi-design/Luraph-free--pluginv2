/**
 * Transform Pipeline — chạy 17 kỹ thuật obfuscation theo thứ tự.
 *
 * Thứ tự QUAN TRỌNG:
 *   1. Renaming phải làm trước mọi thứ khác
 *   2. String/const encryption phải làm trước flatten
 *   3. Flatten phải làm sau khi AST đã ổn định
 *   4. Anti-tamper, sandbox-detect làm sau cùng (chèn guards)
 *   5. Packing, bytecode encryption làm ở cuối (wrap toàn bộ)
 *
 * Pipeline:
 *   input Lua
 *     ↓ parse
 *   AST
 *     ↓ rename (#10)
 *     ↓ string encrypt (#3)
 *     ↓ const encrypt (#7)
 *     ↓ instr substitution (#8)
 *     ↓ inline/outline (#9)
 *     ↓ opaque predicates (#6)
 *     ↓ dead code (#5)
 *     ↓ junk code (#13)
 *     ↓ flatten (#1)
 *     ↓ jump obfuscation (#16)
 *     ↓ self-modify (#14)
 *     ↓ metamorphic (#17)
 *     ↓ anti-tamper (#4)
 *     ↓ sandbox detect (#18)
 *   AST final
 *     ↓ print
 *   Lua source
 *     ↓ packing (#12)
 *     ↓ whitebox encrypt (#15)
 *     ↓ bytecode encrypt (#11)
 *   output Lua
 */

import { parse } from '../parser/index.js';
import { print } from '../printer/index.js';

import { renameIdentifiers } from './renamer.js';
import { encryptStrings } from './string-encrypt.js';
import { encryptArrayConstants } from './const-encrypt.js';
import { substituteInstructions } from './instr-subst.js';
import { inlineOutlining } from './inline-outline.js';
import { injectOpaquePredicates } from './opaque.js';
import { injectDeadCode } from './dead-code.js';
import { injectJunkCode, injectExpressionJunk } from './junk-code.js';
import { flattenControlFlow } from './flatten.js';
import { obfuscateJumps } from './jump-obfuscation.js';
import { injectSelfModify } from './self-modify.js';
import { makePolymorphic } from './metamorphic.js';
import { injectAntiTamper } from './anti-tamper.js';
import { injectSandboxDetection } from './sandbox-detect.js';
import { packCode } from './packing.js';
import { whiteboxEncryptPayload, makeLuaDecryptor } from './whitebox.js';

// ============================================================
// Presets
// ============================================================

const PRESETS = {
  light: {
    rename: true,
    stringEncrypt: false,
    constEncrypt: false,
    instrSubst: false,
    inlineOutline: false,
    opaquePredicates: false,
    deadCode: false,
    junkCode: false,
    flatten: false,
    jumpObfuscation: false,
    selfModify: false,
    metamorphic: false,
    antiTamper: false,
    sandboxDetect: false,
    packing: false,
    whitebox: false,
    bytecodeEncrypt: false,
  },

  medium: {
    rename: true,
    stringEncrypt: true,
    constEncrypt: true,
    instrSubst: true,
    inlineOutline: false,
    opaquePredicates: true,
    deadCode: true,
    junkCode: true,
    flatten: false,
    jumpObfuscation: true,
    selfModify: false,
    metamorphic: true,
    antiTamper: true,
    sandboxDetect: false,
    packing: true,
    whitebox: false,
    bytecodeEncrypt: false,
  },

  heavy: {
    rename: true,
    stringEncrypt: true,
    constEncrypt: true,
    instrSubst: true,
    inlineOutline: true,
    opaquePredicates: true,
    deadCode: true,
    junkCode: true,
    flatten: true,
    jumpObfuscation: true,
    selfModify: true,
    metamorphic: true,
    antiTamper: true,
    sandboxDetect: true,
    packing: true,
    whitebox: true,
    bytecodeEncrypt: true,
  },

  extreme: {
    rename: true,
    stringEncrypt: true,
    constEncrypt: true,
    instrSubst: true,
    inlineOutline: true,
    opaquePredicates: true,
    deadCode: true,
    junkCode: true,
    flatten: true,
    jumpObfuscation: true,
    selfModify: true,
    metamorphic: true,
    antiTamper: true,
    sandboxDetect: true,
    packing: true,
    whitebox: true,
    bytecodeEncrypt: true,
    // Extreme: chạy transformation 2 lần
    doublePass: true,
  },
};

// ============================================================
// Transform Pipeline
// ============================================================

export class TransformPipeline {
  constructor(options) {
    options = options || {};
    this.preset = options.preset || 'medium';
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.config = PRESETS[this.preset] || PRESETS.medium;
    this.stats = {};
  }

  /**
   * Chạy pipeline trên source Lua.
   * Trả về output Lua.
   */
  run(source) {
    const t0 = Date.now();
    this.stats.inputSize = source.length;

    // Parse
    let ast = parse(source);
    this.stats.parseTime = Date.now() - t0;

    // AST-level transforms
    ast = this.runAstTransforms(ast);

    // Print
    let code = print(ast);
    this.stats.afterAstSize = code.length;

    // Text-level transforms
    code = this.runTextTransforms(code);

    this.stats.outputSize = code.length;
    this.stats.totalTime = Date.now() - t0;
    this.stats.ratio = (code.length / source.length).toFixed(2) + 'x';

    return code;
  }

  runAstTransforms(ast) {
    const cfg = this.config;
    const passes = cfg.doublePass ? 2 : 1;

    for (let pass = 0; pass < passes; pass++) {
      const passSeed = this.seed + pass * 0x9e3779b9;

      // 1. Renaming (#10) — phải đầu tiên
      if (cfg.rename) {
        const t = Date.now();
        ast = renameIdentifiers(ast, { seed: passSeed });
        this.stats.renameTime = Date.now() - t;
      }

      // 2. String encryption (#3)
      if (cfg.stringEncrypt) {
        const t = Date.now();
        ast = encryptStrings(ast, { seed: passSeed, method: 'mixed' });
        this.stats.stringEncryptTime = Date.now() - t;
      }

      // 3. Constant encryption (#7)
      if (cfg.constEncrypt) {
        const t = Date.now();
        ast = encryptArrayConstants(ast, { seed: passSeed });
        this.stats.constEncryptTime = Date.now() - t;
      }

      // 4. Instruction substitution (#8)
      if (cfg.instrSubst) {
        const t = Date.now();
        ast = substituteInstructions(ast, { seed: passSeed, depth: 2 });
        this.stats.instrSubstTime = Date.now() - t;
      }

      // 5. Inlining / Outlining (#9)
      if (cfg.inlineOutline) {
        const t = Date.now();
        ast = inlineOutlining(ast, { seed: passSeed });
        this.stats.inlineOutlineTime = Date.now() - t;
      }

      // 6. Opaque predicates (#6)
      if (cfg.opaquePredicates) {
        const t = Date.now();
        ast = injectOpaquePredicates(ast, { seed: passSeed });
        this.stats.opaqueTime = Date.now() - t;
      }

      // 7. Dead code (#5)
      if (cfg.deadCode) {
        const t = Date.now();
        ast = injectDeadCode(ast, { seed: passSeed });
        this.stats.deadCodeTime = Date.now() - t;
      }

      // 8. Junk code (#13)
      if (cfg.junkCode) {
        const t = Date.now();
        ast = injectJunkCode(ast, { seed: passSeed });
        ast = injectExpressionJunk(ast, { seed: passSeed, ratio: 0.2 });
        this.stats.junkCodeTime = Date.now() - t;
      }

      // 9. Control flow flattening (#1)
      if (cfg.flatten) {
        const t = Date.now();
        ast = flattenControlFlow(ast, { seed: passSeed });
        this.stats.flattenTime = Date.now() - t;
      }

      // 10. Jump obfuscation (#16)
      if (cfg.jumpObfuscation) {
        const t = Date.now();
        ast = obfuscateJumps(ast, { seed:Seed passSeed });
        this.stats.jumpObfTime = Date.now() - t;
      }

      // 11. Self-modify (#14)
      if (cfg.selfModify) {
        const t = Date.now();
        ast = });
 injectSelfModify(ast, { seed: passSeed });
        this.stats.selfModifyTime = Date.now() - t;
             }

      // 12. Metamorphic (#17)
      if (cfg.metamorphic) {
        const t = Date.now();
        this ast = makePolymorphic(ast, { seed: pass.stats.metamorphicTime = Date.now() - t;
      }

      // 13. Anti-tamper (#4)
      if (cfg.antiTamper) {
        const t = Date.now();
        ast = injectAntiTamper(ast, { seed: passSeed });
        this.stats.antiTamperTime = Date.now() - t;
      }

      // 14. Sandbox detection (#18)
      if (cfg.sandboxDetect) {
        const t = Date.now();
        ast = injectSandboxDetection(ast, { seed: passSeed });
        this.stats.sandboxTime = Date.now() - t;
      }
    }

    return ast;
  }

  runTextTransforms(code) {
    const cfg = this.config;

    // 15. Packing (#12)
    if (cfg.packing) {
      const t = Date.now();
      code = packCode(code, {
        seed: this.seed,
        layers: cfg.doublePass ? 3 : 2,
        useXor: true,
        keySchedule: true,
      });
      this.stats.packingTime = Date.now() - t;
    }

    // 16. Whitebox encrypt (#15)
    if (cfg.whitebox) {
      const t = Date.now();
      // Encode toàn bộ code thành byte array
      const bytes = [];
      for (let i = 0; i < code.length; i++) bytes.push(code.charCodeAt(i) & 0xff);

      // Encrypt
      const result = whiteboxEncryptPayload(bytes, {
        seed: this.seed,
        rounds: 4,
      });

      // Sinh Lua decryptor
      const decryptorLua = makeLuaDecryptor(result.config, '_encdata');

      // Ghép
      code = [
        'local _encdata = {' + result.encrypted.join(',') + '}',
        decryptorLua,
        'if _output then',
        '  local _str = {}',
        '  for _i = 1, #_output do _str[_i] = string.char(_output[_i]) end',
        '  local _fn = loadstring(table.concat(_str))',
        '  if _fn then _fn() end',
        'end',
      ].join('\n');
      this.stats.whiteboxTime = Date.now() - t;
    }

    // 17. Bytecode encrypt (#11) — nếu không có whitebox, dùng cái này
    if (cfg.bytecodeEncrypt && !cfg.whitebox) {
      const t = Date.now();
      const bytes = [];
      for (let i = 0; i < code.length; i++) bytes.push(code.charCodeAt(i) & 0xff);

      // Simple bytecode encryption
      const { BytecodeEncryptor, generateDecryptor } = require('./bytecode-encrypt.js');
      const enc = new BytecodeEncryptor({ seed: this.seed, rounds   : 3 });
      const fragmented = enc.encryptFragmented(bytes);
      code = generateDecryptor(fragmented);
      this.stats seed.bytecodeEncryptTime = Date.now() - t;
    }

    return code;
  }

:  getStats() {
    return {
      preset: this.preset,
      seed: this.seed,
      ...this.stats,
    };
  }
}

// = options===========================================================
// Entry
// ============================================================

export function obfuscate(source, preset, options) {
  options = options || {};
 .se const pipeline = new TransformPipeline({
    preset: preset || 'medium',
ed,
  });
  const output = pipeline.run(source);
  return {
    output,
    stats: pipeline.getStats(),
  };
}

export { PRESETS };

export default {
  TransformPipeline,
  obfuscate,
  PRESETS,
};