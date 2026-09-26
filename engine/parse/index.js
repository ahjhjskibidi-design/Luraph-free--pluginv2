/**
 * Parser — main entry point.
 *
 * Usage:
 *   import { parse } from './engine/parser/index.js';
 *   const ast = parse('local x = 42');
 *
 * The Parser is a thin wrapper around the token stream. It exposes
 * matching primitives (`check`, `expect`, `peek`, `next`) and delegates
 * the actual node construction to statements.js and expressions.js.
 */

import { tokenize } from '../lexer/index.js';
import { TOKEN_TYPE, describe } from '../lexer/token.js';
import * as A from './ast.js';
import { parseStatement } from './statements.js';
import { ParseError, unexpected } from './errors.js';
import { isKeyword } from '../lexer/keywords.js';

class Parser {
  constructor(source) {
    this.tokens = tokenize(source);
    this.pos = 0;
  }

  // --- Token stream primitives ---

  peek(offset) {
    return this.tokens[this.pos + (offset || 0)];
  }

  next() {
    return this.tokens[this.pos++];
  }

  eof() {
    return this.peek().type === TOKEN_TYPE.EOF;
  }

  checkOp(op) {
    const t = this.peek();
    return t.type === TOKEN_TYPE.OP && t.value === op;
  }

  checkKeyword(kw) {
    const t = this.peek();
    return t.type === TOKEN_TYPE.KEYWORD && t.value === kw;
  }

  expectOp(op) {
    if (this.checkOp(op)) return this.next();
    unexpected(this.peek(), `'${op}'`);
  }

  expectKeyword(kw) {
    if (this.checkKeyword(kw)) return this.next();
    unexpected(this.peek(), `'${kw}'`);
  }

  expectName() {
    const t = this.peek();
    if (t.type !== TOKEN_TYPE.NAME) {
      unexpected(t, 'a name');
    }
    this.pos++;
    return t.value;
  }

  // --- Program ---

  parseChunk() {
    const body = this.parseBlock();
    if (!this.eof()) {
      unexpected(this.peek(), 'end of input');
    }
    return A.chunk(body);
  }

  /**
   * Parse a block of statements until a terminator (`end`, `else`,
   * `elseif`, `until`, or EOF).
   */
  parseBlock() {
    const stmts = [];
    while (!this.eof() && !this.isBlockTerminator()) {
      if (this.checkOp(';')) {
        this.next();
        continue;
      }
      const stmt = parseStatement(this);
      if (stmt) stmts.push(stmt);
    }
    return A.block(stmts);
  }

  isBlockTerminator() {
    const t = this.peek();
    if (t.type === TOKEN_TYPE.EOF) return true;
    if (t.type !== TOKEN_TYPE.KEYWORD) return false;
    return ['end', 'else', 'elseif', 'until'].includes(t.value);
  }
}

export function parse(source) {
  return new Parser(source).parseChunk();
}

export { Parser, ParseError };
export default { parse, Parser, ParseError };