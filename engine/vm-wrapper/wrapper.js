/**
 * Wrapper — ghép tất cả thành output Lua hoàn chỉnh.
 *
 * Output structure:
 *   1. Anti-tamper header (comments)
 *   2. VM Lua source (đã rename)
 *   3. Encrypted bytecode data (as Lua table literals)
 *   4. Key schedule (as Lua table)
 *   5. Proto metadata
 *   6. Bootstrap code (decrypt + run)
 */

import { encryptProgram } from './encryptor.js';
import { getVMForBuild } from './vm-embed.js';

// ============================================================
// Format helpers
// ============================================================

function formatByteArray(bytes, varName, perLine = 32) {
  const lines = [];
  lines.push('local ' + varName + ' = {');
  for (let i = 0; i < bytes.length; i += perLine) {
    const chunk = bytes.slice(i, i + perLine).join(',');
    lines.push('  ' + chunk + ',');
  }
  lines.push('}');
  return lines.join('\n');
}

function formatKeySchedule(schedule, varName) {
  const lines = [];
  lines.push('local ' + varName + ' = {');
  for (const key of schedule) {
    lines.push('  {' + key.join(',') + '},');
  }
  lines.push('}');
  return lines.join('\n');
}

function formatProtoOffsets(offsets, varName) {
  const lines = [];
  lines.push('local ' + varName + ' = {');
  for (const off of offsets) {
    lines.push('  {kind="' + off.kind + '", offset=' + off.offset + ', length=' + off.length + '},');
  }
  lines.push('}');
  return lines.join('\n');
}

function formatConstants(constants, varName) {
  const lines = [];
  lines.push('local ' + varName + ' = {');
  for (const c of constants) {
    if (c.type === 0) {
      lines.push('  {type=0},');
    } else if (c.type === 1) {
      lines.push('  {type=1, value=' + (c.value ? 'true' : 'false') + '},');
    } else if (c.type === 2) {
      lines.push('  {type=2, value=' + c.value + '},');
    } else if (c.type === 3) {
      // String — escape
      const escaped = JSON.stringify(c.value);
      lines.push('  {type=3, value=' + escaped + '},');
    }
  }
  lines.push('}');
  return lines.join('\n');
}

function formatProtosMetadata(protos, varName) {
  const lines = [];
  lines.push('local ' + varName + ' = {');
  for (const p of protos) {
    const params = JSON.stringify(p.params || []);
    const upvalues = JSON.stringify(p.upvalues || []);
    lines.push('  {params=' + params + ', isVararg=' + (p.isVararg ? 'true' : 'false') +
               ', upvalues=' + upvalues + ', registerCount=' + (p.registerCount || 0) + '},');
  }
  lines.push('}');
  return lines.join('\n');
}

// ============================================================
// Bootstrap generator
// ============================================================

function generateBootstrap(options) {
  const { vmEntry, vmVarName } = options;

  return `
-- ============================================================
-- Bootstrap — decrypt and run
-- ============================================================

local function _decrypt()
  local out = {}
  local prevKey = {}

  for _fi = 1, #_frags do
    local _frag = _frags[_fi]
    local _key = _keys[_fi]

    -- Multi-round decrypt
    local _cur = _frag.bytes
    for _r = 1, ${options.rounds} do
      -- XOR
      local _xored = {}
      for _i = 1, #_cur do
        _xored[_i] = bit32.bxor(_cur[_i], _key[((_i - 1) % #_key) + 1])
      end

      -- Rotate right 1
      if #_xored > 0 then
        local _last = _xored[#_xored]
        table.remove(_xored)
        table.insert(_xored, 1, _last)
      end

      _cur = _xored
    end

    -- Append to out
    for _i = 1, #_cur do
      out[#out + 1] = _cur[_i]
    end
  end

  return out
end

local function _bytesToInstructions(bytes)
  local insts = {}
  for i = 1, #bytes, 6 do
    insts[#insts + 1] = {
      bytes[i] or 0,
      bytes[i + 1] or 0,
      bytes[i + 2] or 0,
      bytes[i + 3] or 0,
      bytes[i + 4] or 0,
      bytes[i + 5] or 0,
    }
  end
  return insts
end

local function _buildProgram()
  local allBytes = _decrypt()
  local instructions = _bytesToInstructions(allBytes)

  -- Slice by offsets
  local mainInsts = {}
  local mainOff = _offsets[1]
  for i = 1, mainOff.length / 6 do
    mainInsts[i] = instructions[i]
  end

  local protos = {}
  for pi = 2, #_offsets do
    local off = _offsets[pi]
    local protoInsts = {}
    local startIdx = off.offset / 6 + 1
    for i = 1, off.length / 6 do
      protoInsts[i] = instructions[startIdx + i - 1]
    end
    local meta = _protosMeta[pi - 1] or {}
    protos[pi - 1] = {
      instructions = protoInsts,
      params = meta.params or {},
      isVararg = meta.isVararg or false,
      upvalues = meta.upvalues or {},
      registerCount = meta.registerCount or 0,
    }
  end

  return {
    version = 1,
    constants = _constants,
    protos = protos,
    main = {
      instructions = mainInsts,
      registerCount = 256,
      params = {},
      isVararg = true,
      upvalues = {},
    },
  }
end

local _program = _buildProgram()
local ${vmVarName} = (function()
  -- inline VM source
  local function _load()
    return ${vmEntry === undefined ? 'nil' : 'nil'}  -- placeholder
  end
  return _load()
end)
`.trim();
}

// ============================================================
// Main wrapper
// ============================================================

export function wrapProgram(program, options) {
  options = options || {};
  const seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));

  // 1. Encrypt bytecode
  const encrypted = encryptProgram(program, {
    seed,
    rounds: options.rounds || 3,
    fragmentSize: options.fragmentSize || 128,
  });

  // 2. Get VM Lua source
  const vm = getVMForBuild(seed);

  // 3. Build output parts
  const parts = [];

  // Header
  parts.push('-- Obfuscated with VM-Dual');
  parts.push('-- Generated ' + new Date().toISOString());
  parts.push('-- Preset: ' + (options.preset || 'medium'));
  parts.push('');

  // Anti-tamper guards (nếu có)
  if (options.antiTamper) {
    parts.push('-- Anti-tamper');
    parts.push('if type(_G) ~= "table" then return end');
    parts.push('if type(string) ~= "table" then return end');
    parts.push('if type(bit32) ~= "table" then return end');
    parts.push('');
  }

  // VM Lua source (đã rename)
  parts.push('-- ============================================================');
  parts.push('-- VM Lua — Custom bytecode interpreter');
  parts.push('-- ============================================================');
  parts.push('');
  parts.push(vm.source);
  parts.push('');

  // Constants
  parts.push('-- Constants');
  parts.push(formatConstants(program.constants, '_constants'));
  parts.push('');

  // Proto metadata
  parts.push('-- Proto metadata');
  parts.push(formatProtosMetadata(program.protos, '_protosMeta'));
  parts.push('');

  // Encrypted fragments
  parts.push('-- Encrypted fragments');
  parts.push('local _frags = {');
  for (const frag of encrypted.fragments) {
    parts.push('  {bytes={' + frag.bytes.join(',') + '}, checksum=' + frag.checksum + '},');
  }
  parts.push('}');
  parts.push('');

  // Key schedule
  parts.push('-- Key schedule');
  parts.push(formatKeySchedule(encrypted.keySchedule, '_keys'));
  parts.push('');

  // Proto offsets
  parts.push('-- Proto offsets');
  parts.push(formatProtoOffsets(encrypted.protoOffsets, '_offsets'));
  parts.push('');

  // Bootstrap
  parts.push('-- ============================================================');
  parts.push('-- Bootstrap');
  parts.push('-- ============================================================');
  parts.push('');
  parts.push('local function _decrypt()');
  parts.push('  local out = {}');
  parts.push('  for _fi = 1, #_frags do');
  parts.push('    local _frag = _frags[_fi]');
  parts.push('    local _key = _keys[_fi]');
  parts.push('    local _cur = _frag.bytes');
  parts.push('    for _r = 1, ' + encrypted.rounds + ' do');
  parts.push('      local _xored = {}');
  parts.push('      for _i = 1, #_cur do');
  parts.push('        _xored[_i] = bit32.bxor(_cur[_i], _key[((_i - 1) % #_key) + 1])');
  parts.push('      end');
  parts.push('      if #_xored > 0 then');
  parts.push('        local _last = _xored[#_xored]');
  parts.push('        table.remove(_xored)');
  parts.push('        table.insert(_xored, 1, _last)');
  parts.push('      end');
  parts.push('      _cur = _xored');
  parts.push('    end');
  parts.push('    for _i = 1, #_cur do');
  parts.push('      out[#out + 1] = _cur[_i]');
  parts.push('    end');
  parts.push('  end');
  parts.push('  return out');
  parts.push('end');
  parts.push('');
  parts.push('local function _buildProgram()');
  parts.push('  local allBytes = _decrypt()');
  parts.push('  local function _getInst(idx)');
  parts.push('    local b = idx * 6 + 1');
  parts.push('    return {');
  parts.push('      allBytes[b] or 0, allBytes[b+1] or 0, allBytes[b+2] or 0,');
  parts.push('      allBytes[b+3] or 0, allBytes[b+4] or 0, allBytes[b+5] or 0,');
  parts.push('    }');
  parts.push('  end');
  parts.push('  local mainOff = _offsets[1]');
  parts.push('  local mainInsts = {}');
  parts.push('  for i = 1, math.floor(mainOff.length / 6) do');
  parts.push('    mainInsts[i] = _getInst(i - 1)');
  parts.push('  end');
  parts.push('  local protos = {}');
  parts.push('  for pi = 2, #_offsets do');
  parts.push('    local off = _offsets[pi]');
  parts.push('    local startIdx = math.floor(off.offset / 6)');
  parts.push('    local protoInsts = {}');
  parts.push('    for i = 1, math.floor(off.length / 6) do');
  parts.push('      protoInsts[i] = _getInst(startIdx + i - 1)');
  parts.push('    end');
  parts.push('    local meta = _protosMeta[pi - 1] or {}');
  parts.push('    protos[pi - 1] = {');
  parts.push('      instructions = protoInsts,');
  parts.push('      params = meta.params or {},');
  parts.push('      isVararg = meta.isVararg or false,');
  parts.push('      upvalues = meta.upvalues or {},');
  parts.push('      registerCount = meta.registerCount or 0,');
  parts.push('    }');
  parts.push('  end');
  parts.push('  return {');
  parts.push('    version = 1,');
  parts.push('    constants = _constants,');
  parts.push('    protos = protos,');
  parts.push('    main = {');
  parts.push('      instructions = mainInsts,');
  parts.push('      registerCount = 256,');
  parts.push('      params = {},');
  parts.push('      isVararg = true,');
  parts.push('      upvalues = {},');
  parts.push('    },');
  parts.push('  }');
  parts.push('end');
  parts.push('');
  parts.push('local _program = _buildProgram()');
  parts.push('local _vm = ' + vm.vmEntry.replace('.run', ''));
  parts.push('if _vm then');
  parts.push('  _vm.run(_program)');
  parts.push('else');
  parts.push('  error("VM not found")');
  parts.push('end');

  return parts.join('\n');
}

export default { wrapProgram };