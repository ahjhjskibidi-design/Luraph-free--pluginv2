/**
 * Scope tracking.
 *
 * The compiler needs to know, for each identifier, whether it is:
 *   - a local (register allocated)
 *   - an upvalue (captured from an enclosing function)
 *   - a global (accessed via _G)
 *
 * Scopes form a chain. Each function body starts a new scope chain.
 * Locals are freed when their block ends, so the register allocator
 * can reuse them.
 */

export class Local {
  constructor(name, register, scopeDepth) {
    this.name = name;
    this.register = register;
    this.scopeDepth = scopeDepth;
  }
}

export class Scope {
  constructor(parent) {
    this.parent = parent;
    this.locals = [];
    this.upvalues = [];
    this.nextRegister = 0;
    this.depth = parent ? parent.depth + 1 : 0;
  }

  /**
   * Declare a new local. Assigns it the next available register.
   * Returns the Local instance.
   */
  declareLocal(name) {
    const reg = this.nextRegister++;
    const local = new Local(name, reg, this.depth);
    this.locals.push(local);
    return local;
  }

  /**
   * Look up a local by name in this scope chain.
   * Returns the Local, or null if not found.
   */
  findLocal(name) {
    for (let i = this.locals.length - 1; i >= 0; i--) {
      if (this.locals[i].name === name) return this.locals[i];
    }
    return this.parent ? this.parent.findLocal(name) : null;
  }

  /**
   * Look up an identifier's resolution:
   *   { kind: 'local', register: N }
   *   { kind: 'upvalue', index: N }
   *   { kind: 'global' }
   */
  resolve(name) {
    const local = this.findLocal(name);
    if (local) return { kind: 'local', register: local.register };

    // Check enclosing function for capture
    const upvalue = this.findUpvalue(name);
    if (upvalue !== null) return { kind: 'upvalue', index: upvalue };

    return { kind: 'global' };
  }

  /**
   * Find or create an upvalue that captures `name` from the enclosing
   * function. Returns the upvalue index, or null if not found.
   */
  findUpvalue(name) {
    // Only check parent scope chain (locals of enclosing function)
    if (!this.parent) return null;

    const parentLocal = this.parent.findLocal(name);
    if (parentLocal) {
      // Add a new upvalue entry for this
      const idx = this.upvalues.length;
      this.upvalues.push({ name, fromParentLocal: parentLocal.register });
      return idx;
    }

    const parentUpvalue = this.parent.findUpvalue(name);
    if (parentUpvalue !== null) {
      const idx = this.upvalues.length;
      this.upvalues.push({ name, fromParentUpvalue: parentUpvalue });
      return idx;
    }

    return null;
  }

  /**
   * Enter a nested block. Registers declared after this point are freed
   * when `endBlock` is called.
   */
  enterBlock() {
    this.blockStart = this.nextRegister;
  }

  /**
   * Exit a nested block. Frees registers allocated inside the block.
   */
  exitBlock() {
    if (this.blockStart !== undefined) {
      this.nextRegister = this.blockStart;
      this.blockStart = undefined;
    }
  }

  /**
   * Allocate a temporary register (not tied to a named local).
   * Callers must free it explicitly.
   */
  allocTemp() {
    return this.nextRegister++;
  }

  freeTemp(reg) {
    if (reg === this.nextRegister - 1) {
      this.nextRegister--;
    }
  }

  /**
   * Reserve N consecutive registers.
   * Returns the first register number.
   */
  allocN(n) {
    const start = this.nextRegister;
    this.nextRegister += n;
    return start;
  }
}

export default { Local, Scope };