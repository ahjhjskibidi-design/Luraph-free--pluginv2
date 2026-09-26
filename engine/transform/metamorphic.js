// ============================================================
// (tiếp theo từ file trước)
// ============================================================

      case 4:
        // ~n (bitwise)
        if (Number.isInteger(value) && value >= 0 && value <= 0xffffffff) {
          return A.unaryExpression(
            '~',
            A.numberLiteral((~value) >>> 0, '0x' + ((~value) >>> 0).toString(16)),
          );
        }
        return A.numberLiteral(value);

      case 5:
        // Default — plain
        return A.numberLiteral(value);

      default:
        return A.numberLiteral(value);
    }
  }

  /**
   * Sinh variant của một binary operator.
   * Ví dụ: `+` có thể được viết lại thành `- (-b) + a`
   */
  randomBinaryVariant(op, left, right) {
    const variant = this.rng.nextInt(4);

    switch (op) {
      case '+':
        if (variant === 0) return A.binaryExpression(left, '+', right);
        if (variant === 1) return A.binaryExpression(left, '-', A.unaryExpression('-', right));
        if (variant === 2) return A.binaryExpression(right, '+', left);
        return A.binaryExpression(left, '+', right);

      case '-':
        if (variant === 0) return A.binaryExpression(left, '-', right);
        if (variant === 1) return A.binaryExpression(left, '+', A.unaryExpression('-', right));
        return A.binaryExpression(left, '-', right);

      case '*':
        if (variant === 0) return A.binaryExpression(left, '*', right);
        if (variant === 1) return A.binaryExpression(right, '*', left);
        return A.binaryExpression(left, '*', right);

      case '==':
        if (variant === 0) return A.binaryExpression(left, '==', right);
        if (variant === 1) return A.unaryExpression('not', A.binaryExpression(left, '~=', right));
        return A.binaryExpression(left, '==', right);

      default:
        return A.binaryExpression(left, op, right);
    }
  }

  /**
   * Sinh variant của một identifier reference.
   * Ví dụ: `x` → `(x)`, `x + 0`, `x * 1`
   */
  randomIdentifierVariant(name) {
    const variant = this.rng.nextInt(3);

    switch (variant) {
      case 0:
        return A.identifier(name);
      case 1:
        return A.binaryExpression(
          A.identifier(name),
          '+',
          A.numberLiteral(0),
        );
      case 2:
        return A.binaryExpression(
          A.identifier(name),
          '*',
          A.numberLiteral(1),
        );
      default:
        return A.identifier(name);
    }
  }
}

// ============================================================
// Polymorphic Transformer
// ============================================================

export class PolymorphicTransformer {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.ratio = options.ratio !== undefined ? options.ratio : 0.4;
    this.generator = new PolymorphicGenerator({ seed: this.seed });
    this.counter = 0;
  }

  transform(ast) {
    this.visit(ast);
    return ast;
  }

  visit(node) {
    if (!node || typeof node !== 'object') return;

    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          if (value[i] && typeof value[i] === 'object' && value[i].type) {
            value[i] = this.maybeTransform(value[i]);
            this.visit(value[i]);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        node[key] = this.maybeTransform(value);
        this.visit(node[key]);
      }
    }
  }

  maybeTransform(node) {
    if (!node || typeof node !== 'object') return node;

    this.counter++;
    if ((this.counter % 100) / 100 > this.ratio) return node;

    // Number literal
    if (node.type === NodeType.NUMBER) {
      return this.generator.makeRandomNumber(node.value);
    }

    // Binary expression
    if (node.type === NodeType.BINARY) {
      return this.generator.randomBinaryVariant(
        node.operator,
        node.left,
        node.right,
      );
    }

    // Identifier
    if (node.type === NodeType.IDENT) {
      // Chỉ transform đôi khi
      if (this.generator.rng.nextInt(100) < 20) {
        return this.generator.randomIdentifierVariant(node.name);
      }
      return node;
    }

    return node;
  }
}

// ============================================================
// Build-Variant Selector
// ============================================================

/**
 * Mỗi lần build tạo variant khác. Class này chọn seed + config.
 */
export class BuildVariant {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Date.now() ^ (Math.random() * 0x7fffffff));
    this.rng = new XorShift32(this.seed);
  }

  /**
   * Chọn config ngẫu nhiên cho build này.
   */
  pickConfig() {
    return {
      // Layers đa dạng
      bytecodeRounds: 2 + this.rng.nextInt(4),
      fragmentSize: 32 + this.rng.nextInt(32),

      // Kỹ thuật ratio
      deadCodeRatio: 0.2 + this.rng.nextFloat() * 0.3,
      junkCodeRatio: 0.2 + this.rng.nextFloat() * 0.3,
      opaqueRatio: 0.2 + this.rng.nextFloat() * 0.3,
      substRatio: 0.3 + this.rng.nextFloat() * 0.4,
      flattenRatio: 0.5 + this.rng.nextFloat() * 0.4,

      // Crypto
      keyLength: 8 + this.rng.nextInt(24),
      sboxSize: 256,

      // Opcode mapping
      opcodeMappingSeed: this.rng.next(),

      // Rename
      renamePrefix: '_' + this.rng.next().toString(36).slice(0, 3),
    };
  }

  /**
   * Report về build.
   */
  describe() {
    const cfg = this.pickConfig();
    return {
      seed: this.seed,
      ...cfg,
    };
  }
}

// ============================================================
// Entry
// ============================================================

export function makePolymorphic(ast, options) {
  const transformer = new PolymorphicTransformer(options);
  return transformer.transform(ast);
}

export function createBuildVariant(options) {
  return new BuildVariant(options);
}

export default {
  PolymorphicGenerator,
  PolymorphicTransformer,
  BuildVariant,
  makePolymorphic,
  createBuildVariant,
};