/**
 * Constant pool.
 *
 * Every number, string, boolean, and nil literal the compiled program
 * uses is stored once. Instructions reference constants by index.
 *
 * The pool deduplicates: adding the same string twice returns the
 * same index. This keeps the output small and lets the encoder
 * compress similar constants.
 */

export const CONST_TYPE = {
  NIL: 0,
  BOOL: 1,
  NUMBER: 2,
  STRING: 3,
};

export class ConstantPool {
  constructor() {
    this.entries = [];
    this.lookup = new Map();
  }

  /**
   * Add a constant. Returns its index.
   * Deduplicates by type + value.
   */
  add(value) {
    const key = this.keyFor(value);
    if (this.lookup.has(key)) return this.lookup.get(key);

    let entry;
    if (value === null) {
      entry = { type: CONST_TYPE.NIL, value: null };
    } else if (typeof value === 'boolean') {
      entry = { type: CONST_TYPE.BOOL, value };
    } else if (typeof value === 'number') {
      entry = { type: CONST_TYPE.NUMBER, value };
    } else if (typeof value === 'string') {
      entry = { type: CONST_TYPE.STRING, value };
    } else {
      throw new Error('Cannot add constant of type ' + typeof value);
    }

    const index = this.entries.length;
    this.entries.push(entry);
    this.lookup.set(key, index);
    return index;
  }

  keyFor(value) {
    if (value === null) return 'nil';
    return typeof value + ':' + value;
  }

  size() {
    return this.entries.length;
  }

  get(index) {
    return this.entries[index];
  }
}

export default { CONST_TYPE, ConstantPool };