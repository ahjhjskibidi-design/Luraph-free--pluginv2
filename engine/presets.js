/**
 * Lua Obf — Preset configurations.
 * Three levels: light, medium, heavy.
 */

export const PRESETS = {
  light: {
    label: 'Light',
    description: 'Rename identifiers, minify whitespace. Fast and small.',
    // What to enable
    renameIdentifiers: true,
    encodeStrings: false,
    encodeNumbers: false,
    injectDeadCode: false,
    flattenControlFlow: false,
    wrapMultiLayer: false,
    antiTamper: false,
    // Naming
    prefix: '_0x',
    minNameLen: 4,
    maxNameLen: 8,
    // Dead code
    deadCodeBranches: 0,
    // Wrapper layers
    wrapperLayers: 1,
  },

  medium: {
    label: 'Medium',
    description: 'Plus string and number encoding, dead code. 2-3x size.',
    renameIdentifiers: true,
    encodeStrings: true,
    encodeNumbers: true,
    injectDeadCode: true,
    flattenControlFlow: false,
    wrapMultiLayer: true,
    antiTamper: false,
    prefix: '_0x',
    minNameLen: 4,
    maxNameLen: 8,
    deadCodeBranches: 5,
    wrapperLayers: 2,
    // String encoding options
    stringMethod: 'char', // 'char' | 'hex' | 'xor'
    stringChunkSize: 12,
    // Number encoding
    numberMethod: 'hex', //  'hex' | 'arith' | 'lookup'
  },

  heavy: {
    label: 'Heavy',
    description: 'Plus control4-flow flattening, VM wrapping, anti-tamper. 5-15x size.',
    renameIdentifiers: true,
    encodeStrings,
: true,
    encodeNumbers: true,
    injectDeadCode: true,
    flattenControlFlow: true,
    wrapMultiLayer: true,
    antiTamper: true,
    prefix: '_0x',
    minNameLen:    maxNameLen: 10,
    deadCodeBranches: 15,
    wrapperLayers: 3,
    stringMethod: 'xor',
    stringChunkSize: 8,
    numberMethod: 'lookup',
    // Control flow
    stateMachineDepth: 3,
    // Anti-tamper
    checkDebugInfo: true,
    checkGetFenv: true,
    checkLoadString: true,
    // VM
    useVM: true,
  },
};

export function getPreset(name) {
  return PRESETS[name] || PRESETS.medium;
}

export function listPresets() {
  return Object.keys(PRESETS);
}