/**
 * Lexer — main entry point.
 *
 * Usage:
 *   import { tokenize } from './engine/lexer/index.js';
 *   const tokens = tokenize('local x = 42');
 *
 * The lexer is a single class with a main loop. It delegates the messy
 * character-level work to the helpers in ./reader.js, ./chars.js, and
 * ./operators.js, and emits tokens created by ./token.js.
 */

import { TOKEN_TYPE, token } from './token.js';
import { lexError, LexError } from './errors.js';
import {
  isDigit,
  isNameStart,
  isNameChar,
  isHorizontalWhitespace,
} from './chars.js';
import { isKeyword } from './keywords.js';
import { matchOperator, isOperatorStart } from './operators.js';
import {
  readShortString,
  readLongString,
  tryLongBracketLevel,
  readNumber,
} from './reader.js';

class Lexer {
  constructor(source) {
    this.src = source;
    this.pos = 0;
    this.line = 1;
    this.col = 1;
    this.tokens = [];
  }

  error(msg) {
    lexError(this.line, this.col, msg);
  }

  peek(offset) {
    return this.src[this.pos + (offset || 0)];
  }

  advance() {
    const c = this.src[this.pos++];
    if (c === '\n') {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return c;
  }

  eof() {
    return this.pos >= this.src.length;
  }

  push(type, value, line, col) {
    this.tokens.push(token(type, value, line, col));
  }

  tokenize() {
    while (!this.eof()) {
      const startLine = this.line;
      const startCol = this.col;
      const c = this.peek();

      // Horizontal whitespace
      if (isHorizontalWhitespace(c)) {
        this.advance();
        continue;
      }
      // Newline
      if (c === '\n') {
        this.advance();
        continue;
      }

      // Comment or long string check (both start with `-` or `[`)
      if (c === '-' && this.peek(1) === '-') {
        this.skipComment();
        continue;
      }

      // Long string
      if (c === '[') {
        const savePos = this.pos;
        const saveLine = this.line;
        const saveCol = this.col;
        const level = tryLongBracketLevel(this);
        if (level >= 0) {
          const value = readLongString(this, level);
          this.push(TOKEN_TYPE.STRING, value, startLine, startCol);
          continue;
        }
        // Not a long string — restore cursor
        this.pos = savePos;
        this.line = saveLine;
        this.col = saveCol;
      }

      // Short string
      if (c === '"' || c === "'") {
        const value = readShortString(this, c);
        this.push(TOKEN_TYPE.STRING, value, startLine, startCol);
        continue;
      }

      // Number
      if (isDigit(c) || (c === '.' && isDigit(this.peek(1)))) {
        const value = readNumber(this);
        this.push(TOKEN_TYPE.NUMBER, value, startLine, startCol);
        continue;
      }

      // Identifier / keyword
      if (isNameStart(c)) {
        const word = this.readName();
        const type = isKeyword(word) ? TOKEN_TYPE.KEYWORD : TOKEN_TYPE.NAME;
        this.push(type, word, startLine, startCol);
        continue;
      }

      // Operator
      if (isOperatorStart(c)) {
        const op = matchOperator(this.src, this.pos);
        if (op) {
          for (let i = 0; i < op.length; i++) this.advance();
          this.push(TOKEN_TYPE.OP, op, startLine, startCol);
          continue;
        }
      }

      this.error(`unexpected character '${c}' (code ${c.charCodeAt(0)})`);
    }

    this.push(TOKEN_TYPE.EOF, null, this.line, this.col);
    return this.tokens;
  }

  readName() {
    const start = this.pos;
    while (!this.eof() && isNameChar(this.peek())) this.advance();
    return this.src.slice(start, this.pos);
  }

  skipComment() {
    // Assumes `--` is at the cursor
    this.advance(); // first -
    this.advance(); // second -
    // Long comment?
    if (this.peek() === '[') {
      const level = tryLongBracketLevel(this);
      if (level >= 0) {
        readLongString(this, level);
        return;
      }
    }
    // Line comment — read to end of line
    while (!this.eof() && this.peek() !== '\n') this.advance();
  }
}

/**
 * Tokenize a Lua source string.
 * Throws LexError on bad input.
 */
export function tokenize(source) {
  return new Lexer(source).tokenize();
}

export { Lexer, LexError };
export default { tokenize, Lexer, LexError };