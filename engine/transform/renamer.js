/**
 * Renamer — đổi tên mọi identifier thành chuỗi vô nghĩa.
 *
 * Kỹ thuật #10: Renaming/Identifier Mangling.
 *
 * Chiến lược:
 *   - Local variables → `_0x` + random hex
 *   - Function parameters → `_p` + counter
 *   - Loop variables → `_i` + counter
 *   - Globals được giữ nguyên (không thể rename vì Roblox biết tên)
 *   - Upvalues theo closure scope
 *   - Labels (nếu có) → `_l` + random
 *
 * Mỗi lần build dùng seed khác → output khác nhau.
 *
 * Đây là kỹ thuật đơn giản nhất nhưng cũng quan trọng nhất. Không
 * rename thì mọi kỹ thuật khác đều vô nghĩa vì attacker đọc được
 * tên biến.
 */

import { NodeType } from '../parser/types.js';

// ============================================================
// Name generator
// ============================================================

const CHARS = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';

class NameGenerator {
  constructor(seed, options) {
    options = options || {};
    this.prefix = options.prefix || '_0x';
    this.minLen = options.minLen || 6;
    this.maxLen = options.maxLen || 10;
    this.used = new Set();
    this.counter = 0;
    this.state = (seed >>> 0) || 1;
  }

  nextInt(max) {
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return this.state % max;
  }

  nextHex() {
    const len = this.minLen + this.nextInt(this.maxLen - this.minLen + 1);
    let out = this.prefix;
    for (let i = 0; i < len; i++) {
      out += '0123456789abcdef'[this.nextInt(16)];
    }
    return out;
  }

  next() {
    for (let attempt = 0; attempt < 1000; attempt++) {
      const name = this.nextHex();
      if (!this.used.has(name)) {
        this.used.add(name);
        return name;
      }
      this.counter++;
    }
    // Fallback
    this.counter++;
    return this.prefix + this.counter.toString(36) + Date.now().toString(36);
  }
}

// ============================================================
// Protected names
// ============================================================

/**
 * Tên không được đổi:
 *   - Lua keywords
 *   - Lua standard library
 *   - Roblox globals
 *   - self, _G, _ENV
 */
const LUA_KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
  'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat',
  'return', 'then', 'true', 'until', 'while',
]);

const STD_GLOBALS = new Set([
  '_G', '_VERSION', '_ENV', 'self',
  'assert', 'collectgarbage', 'dofile', 'error', 'getfenv',
  'getmetatable', 'ipairs', 'load', 'loadfile', 'loadstring',
  'module', 'next', 'pairs', 'pcall', 'print', 'rawequal',
  'rawget', 'rawlen', 'rawset', 'require', 'select', 'setfenv',
  'setmetatable', 'tonumber', 'tostring', 'type', 'unpack',
  'xpcall',
  'coroutine', 'debug', 'io', 'math', 'os', 'package',
  'string', 'table', 'bit32', 'utf8',
]);

const ROBLOX_GLOBALS = new Set([
  'game', 'workspace', 'script', 'Instance', 'Vector3', 'Vector2',
  'CFrame', 'Color3', 'BrickColor', 'UDim', 'UDim2', 'Rect', 'Ray',
  'Region3', 'TweenInfo', 'NumberRange', 'NumberSequence',
  'ColorSequence', 'PhysicalProperties', 'Enum', 'wait', 'spawn',
  'delay', 'tick', 'time', 'task', 'typeof', 'warn', 'Random',
  'shared', 'getgenv', 'getrenv', 'getreg', 'hookfunction',
  'getrawmetatable', 'setreadonly', 'isreadonly',
  'firetouchinterest', 'fireclickdetector', 'getconnections',
  'getnilinstances',
  'JSON', 'HttpService', 'Players', 'RunService', 'UserInputService',
  'ReplicatedStorage', 'ServerStorage', 'ServerScriptService',
  'StarterGui', 'StarterPack', 'StarterPlayer', 'Lighting',
  'SoundService', 'TweenService', 'ContextActionService',
  'PathfindingService', 'TeleportService', 'MarketplaceService',
  'DataStoreService', 'MessagingService', 'Chat',
  'Workspace', 'Camera', 'Humanoid', 'Character',
]);

function isProtected(name) {
  return LUA_KEYWORDS.has(name) || STD_GLOBALS.has(name) || ROBLOX_GLOBALS.has(name);
}

// ============================================================
// Scope tracking
// ============================================================

class Scope {
  constructor(parent) {
    this.parent = parent;
    this.bindings = new Map();
  }

  declare(originalName, newName) {
    this.bindings.set(originalName, newName);
  }

  resolve(name) {
    let s = this;
    while (s) {
      if (s.bindings.has(name)) return s.bindings.get(name);
      s = s.parent;
    }
    return null;
  }
}

// ============================================================
// Renamer
// ============================================================

export class Renamer {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.generator = new NameGenerator(this.seed, options);
    this.protectGlobals = options.protectGlobals !== false;
  }

  rename(ast) {
    const scope = new Scope(null);
    this.visitNode(ast, scope);
    return ast;
  }

  // ============================================================
  // Statement visitors
  // ============================================================

  visitNode(node, scope) {
    if (!node || typeof node !== 'object') return;

    switch (node.type) {
      case NodeType.CHUNK:
      case NodeType.BLOCK:
        this.visitBlock(node, scope);
        break;

      case NodeType.LOCAL:
        this.visitLocal(node, scope);
        break;

      case NodeType.LOCAL_FUNC:
        this.visitLocalFunction(node, scope);
        break;

      case NodeType.FUNC_DECL:
        this.visitFunctionDecl(node, scope);
        break;

      case NodeType.ASSIGN:
        this.visitAssign(node, scope);
        break;

      case NodeType.IF:
        this.visitIf(node, scope);
        break;

      case NodeType.WHILE:
        this.visitWhile(node, scope);
        break;

      case NodeType.REPEAT:
        this.visitRepeat(node, scope);
        break;

      case NodeType.FOR_NUM:
        this.visitForNum(node, scope);
        break;

      case NodeType.FOR_GEN:
        this.visitForGen(node, scope);
        break;

      case NodeType.DO:
        this.visitDo(node, scope);
        break;

      case NodeType.RETURN:
        this.visitReturn(node, scope);
        break;

      case NodeType.CALL_STMT:
        this.visitCall(node.expression, scope);
        break;

      case NodeType.BREAK:
        // không cần xử lý
        break;
    }
  }

  visitBlock(block, parentScope) {
    const scope = new Scope(parentScope);
    const body = block.body || [];

    for (const stmt of body) {
      this.visitNode(stmt, scope);
    }
  }

  visitLocal(node, scope) {
    // Visit values trước (dùng scope cũ)
    for (const v of node.values || []) {
      this.visitExpression(v, scope);
    }

    // Sau đó declare names
    for (const nameNode of node.names) {
      const original = nameNode.name;
      if (isProtected(original)) continue;
      const newName = this.generator.next();
      scope.declare(original, newName);
      nameNode.name = newName;
    }
  }

  visitLocalFunction(node, scope) {
    // Declare trước (để recursive)
    const original = node.name.name;
    if (!isProtected(original)) {
      const newName = this.generator.next();
      scope.declare(original, newName);
      node.name.name = newName;
    }

    // Visit params + body
    const funcScope = new Scope(scope);
    for (const param of node.params) {
      if (param.name === 'self') continue;
      if (isProtected(param.name)) continue;
      const newName = this.generator.next();
      funcScope.declare(param.name, newName);
      param.name = newName;
    }
    this.visitBlock(node.body, funcScope);
  }

  visitFunctionDecl(node, scope) {
    // Name có thể là dotted (a.b.c) — không rename
    // Chỉ visit params + body
    const funcScope = new Scope(scope);
    for (const param of node.params) {
      if (param.name === 'self') continue;
      if (isProtected(param.name)) continue;
      const newName = this.generator.next();
      funcScope.declare(param.name, newName);
      param.name = newName;
    }
    this.visitBlock(node.body, funcScope);
  }

  visitAssign(node, scope) {
    // Visit values
    for (const v of node.values || []) {
      this.visitExpression(v, scope);
    }
    // Visit targets
    for (const t of node.targets || []) {
      this.visitExpression(t, scope);
    }
  }

  visitIf(node, scope) {
    for (const clause of node.clauses) {
      this.visitExpression(clause.condition, scope);
      this.visitBlock(clause.body, scope);
    }
    if (node.elseBody) {
      this.visitBlock(node.elseBody, scope);
    }
  }

  visitWhile(node, scope) {
    this.visitExpression(node.condition, scope);
    this.visitBlock(node.body, scope);
  }

  visitRepeat(node, scope) {
    // Repeat body có scope riêng, condition thấy được body locals
    const innerScope = new Scope(scope);
    this.visitBlock(node.body, innerScope);
    this.visitExpression(node.condition, innerScope);
  }

  visitForNum(node, scope) {
    this.visitExpression(node.start, scope);
    this.visitExpression(node.end, scope);
    if (node.step) this.visitExpression(node.step, scope);

    const innerScope = new Scope(scope);
    const original = node.variable.name;
    if (!isProtected(original)) {
      const newName = this.generator.next();
      innerScope.declare(original, newName);
      node.variable.name = newName;
    }
    this.visitBlock(node.body, innerScope);
  }

  visitForGen(node, scope) {
    for (const it of node.iterators || []) {
      this.visitExpression(it, scope);
    }

    const innerScope = new Scope(scope);
    for (const v of node.variables || []) {
      if (isProtected(v.name)) continue;
      const newName = this.generator.next();
      innerScope.declare(v.name, newName);
      v.name = newName;
    }
    this.visitBlock(node.body, innerScope);
  }

  visitDo(node, scope) {
    this.visitBlock(node.body, scope);
  }

  visitReturn(node, scope) {
    for (const v of node.values || []) {
      this.visitExpression(v, scope);
    }
  }

  // ============================================================
  // Expression visitors
  // ============================================================

  visitExpression(node, scope) {
    if (!node || typeof node !== 'object') return;

    switch (node.type) {
      case NodeType.IDENT: {
        const resolved = scope.resolve(node.name);
        if (resolved) {
          node.name = resolved;
        }
        // Global không rename
        break;
      }

      case NodeType.BINARY:
        this.visitExpression(node.left, scope);
        this.visitExpression(node.right, scope);
        break;

      case NodeType.UNARY:
        this.visitExpression(node.argument, scope);
        break;

      case NodeType.CALL:
        this.visitExpression(node.callee, scope);
        for (const a of node.args || []) {
          this.visitExpression(a, scope);
        }
        break;

      case NodeType.METHOD_CALL:
        this.visitExpression(node.object, scope);
        for (const a of node.args || []) {
          this.visitExpression(a, scope);
        }
        // Method name là string key → không đổi
        break;

      case NodeType.INDEX:
        this.visitExpression(node.object, scope);
        if (node.computed) {
          this.visitExpression(node.key, scope);
        }
        // Computed=false → key là string key → không đổi
        break;

      case NodeType.TABLE:
        for (const field of node.fields || []) {
          if (field.type === NodeType.FIELD_KEY) {
            this.visitExpression(field.key, scope);
            this.visitExpression(field.value, scope);
          } else if (field.type === NodeType.FIELD_ARRAY) {
            this.visitExpression(field.value, scope);
          }
        }
        break;

      case NodeType.FUNC_EXPR: {
        const funcScope = new Scope(scope);
        for (const param of node.params || []) {
          if (param.name === 'self') continue;
          if (isProtected(param.name)) continue;
          const newName = this.generator.next();
          funcScope.declare(param.name, newName);
          param.name = newName;
        }
        this.visitBlock(node.body, funcScope);
        break;
      }

      case NodeType.PAREN:
        this.visitExpression(node.expression, scope);
        break;

      // Literals — không xử lý
      case NodeType.STRING:
      case NodeType.NUMBER:
      case NodeType.BOOL:
      case NodeType.NIL:
      case NodeType.VARARG:
        break;
    }
  }
}

// ============================================================
// Entry
// ============================================================

export function renameIdentifiers(ast, options) {
  const renamer = new Renamer(options);
  return renamer.rename(ast);
}

export default { renameIdentifiers, Renamer };