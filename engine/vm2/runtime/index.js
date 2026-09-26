/**
 * Runtime barrel — re-exports everything the VM dispatcher needs.
 *
 * This module is the single import point for the VM. Every submodule
 * is re-exported by name and also aggregated into a `runtime` object
 * so callers can access it as `runtime.arithmetic.luaAdd` if they
 * prefer.
 *
 * The runtime has no side effects on import. Metatable context is
 * installed by the VM at boot, not by importing this file.
 */

// --- Type system ---
export {
  luaTypeName,
  luaTruthy,
  luaToString,
  luaToNumber,
  luaEquals,
  luaLess,
} from './type.js';

// --- Arithmetic ---
export {
  luaAdd,
  luaSub,
  luaMul,
  luaDiv,
  luaIDiv,
  luaMod,
  luaPow,
  luaUnm,
  luaBand,
  luaBor,
  luaBxor,
  luaBnot,
  luaShl,
  luaShr,
} from './arithmetic.js';

// --- Comparison ---
export {
  luaEq,
  luaNe,
  luaLt,
  luaLe,
  luaGt,
  luaGe,
} from './comparison.js';

// --- Table ---
export {
  rawLength,
  tableLength,
  tableGet,
  tableSet,
  tableRawGet,
  tableRawSet,
  tableEquals,
  tableConcat,
  tableInsert,
  tableRemove,
  tableMaxn,
  tableSort,
  tablePack,
  tableUnpack,
  tableMove,
  tableClear,
  tableClone,
  tableCreate,
  tableFind,
  tableFreeze,
  tableIsFrozen,
  tableNext,
  tablePairs,
  tableIPairs,
  makeTableLibrary,
} from './table.js';

// --- String ---
export {
  stringLen,
  stringSub,
  stringByte,
  stringChar,
  stringRep,
  stringLower,
  stringUpper,
  stringReverse,
  stringFormat,
  stringFind,
  stringMatch,
  stringGmatch,
  stringGsub,
  stringDump,
} from './string.js';

// --- Math ---
export {
  mathPi,
  mathHuge,
  mathMaxInteger,
  mathMinInteger,
  mathAbs,
  mathCeil,
  mathFloor,
  mathSqrt,
  mathExp,
  mathSin,
  mathCos,
  mathTan,
  mathAsin,
  mathAcos,
  mathAtan,
  mathAtan2,
  mathSinh,
  mathCosh,
  mathTanh,
  mathDeg,
  mathRad,
  mathLog,
  mathLog10,
  mathFmod,
  mathModf,
  mathFrexp,
  mathLdexp,
  mathMax,
  mathMin,
  mathPow,
  mathRandomSeed,
  mathRandom,
  mathToInteger,
  mathType,
  mathUlt,
  mathClamp,
  mathSign,
  mathRound,
  mathNoise,
  makeMathLibrary,
} from './math.js';

// --- Metatable ---
export {
  setMetamethodContext,
  getContext,
  getTypeMetatable,
  setTypeMetatable,
  getMetatable,
  setMetatable,
  luaGetMetatable,
  luaSetMetatable,
  lookupMetamethod,
  findBinaryMetamethod,
  findUnaryMetamethod,
  callMetamethod,
  tryBinaryMetamethod,
  tryUnaryMetamethod,
  metamethodAdd,
  metamethodSub,
  metamethodMul,
  metamethodDiv,
  metamethodMod,
  metamethodPow,
  metamethodIDiv,
  metamethodUnm,
  metamethodBand,
  metamethodBor,
  metamethodBxor,
  metamethodBnot,
  metamethodShl,
  metamethodShr,
  metamethodEq,
  metamethodLt,
  metamethodLe,
  metamethodIndex,
  metamethodNewIndex,
  metamethodCall,
  metamethodLen,
  metamethodConcat,
  metamethodToString,
  metamethodPairs,
  metamethodIPairs,
  makeMetatableLibrary,
} from './metatable.js';

// --- Error ---
export {
  VMError,
  VMHalt,
  luaError,
  luaAssert,
  luaPcall,
  luaXpcall,
  luaTraceback,
  formatErrorValue,
  wrapError,
  ProtectedRegion,
  pushProtectedRegion,
  popProtectedRegion,
  currentProtectedRegion,
  makeErrorLibrary,
} from './error.js';

// --- Coroutine ---
export {
  STATUS,
  Coroutine,
  CoroutineRegistry,
  coroutineCreate,
  coroutineStatus,
  coroutineRunning,
  coroutineIsYieldable,
  YieldSignal,
  coroutineYield,
  coroutineResume,
  coroutineWrap,
  coroutineClose,
  CoroutineContext,
} from './coroutine.js';

// --- Debug ---
export {
  setDebugContext,
  getDebugContext,
  debugGetinfo,
  debugGetlocal,
  debugSetlocal,
  debugGetupvalue,
  debugSetupvalue,
  debugUpvalueid,
  debugUpvaluejoin,
  debugGetmetatable,
  debugSetmetatable,
  debugGetregistry,
  debugTraceback,
  debugSethook,
  debugGethook,
  debugGetuservalue,
  debugSetuservalue,
  makeDebugLibrary,
} from './debug.js';

// --- Bit32 ---
export {
  bitBand,
  bitBor,
  bitBxor,
  bitBnot,
  bitLshift,
  bitRshift,
  bitArshift,
  bitLrotate,
  bitRrotate,
  bitExtract,
  bitReplace,
  bitBtest,
  makeBit32Library,
} from './bit32.js';

// --- UTF-8 ---
export {
  utf8Charpattern,
  encodeCodepoint,
  decodeCodepoint,
  stringToBytes,
  bytesToString,
  utf8Char,
  utf8Codepoint,
  utf8Len,
  utf8Offset,
  utf8Codes,
  makeUtf8Library,
} from './utf8.js';

// --- OS ---
export {
  osTime,
  setClockOrigin,
  osClock,
  osDate,
  osDifftime,
  osGetenv,
  OSHalt,
  osExit,
  osTmpname,
  osRemove,
  osRename,
  osExecute,
  osSetlocale,
} from './os.js';

// --- IO ---
export {
  FileHandle,
  makeIOLibrary,
} from './io.js';

// --- Package ---
export {
  makePackageLibrary,
} from './package.js';

// ============================================================
// Convenience namespace object
// ============================================================

import * as arithmetic from './arithmetic.js';
import * as comparison from './comparison.js';
import * as tableMod from './table.js';
import * as stringMod from './string.js';
import * as mathMod from './math.js';
import * as metatableMod from './metatable.js';
import * as errorMod from './error.js';
import * as coroutineMod from './coroutine.js';
import * as debugMod from './debug.js';
import * as bit32Mod from './bit32.js';
import * as utf8Mod from './utf8.js';
import * as osMod from './os.js';
import * as ioMod from './io.js';
import * as packageMod from './package.js';

export const runtime = {
  arithmetic,
  comparison,
  table: tableMod,
  string: stringMod,
  math: mathMod,
  metatable: metatableMod,
  error: errorMod,
  coroutine: coroutineMod,
  debug: debugMod,
  bit32: bit32Mod,
  utf8: utf8Mod,
  os: osMod,
  io: ioMod,
  package: packageMod,
};

export default runtime;