/**
 * Lua Obf — Lua parser.
 * Recursive-descent parser producing a plain-object AST.
 * Covers the Lua 5.1 subset used by most Roblox scripts.
 *
 * NOT a full Lua parser. Skips:
 *   - goto/labels (Lua 5.2+)
 *   - some edge cases in long strings with level markers
 *   - comments preserved as metadata (dropped)
 */

import * as A from './ast.js';

const TT = {
  EOF: 'EOF',
  NAME: 'Name',
  NUMBER: 'Number',
  STRING: 'String',
  LONG_STRING: 'LongString',
  KEYWORD: 'Keyword',
  OP: 'Op',
};

const KEYWORDS = new Set([
  'and', 'break', 'do', 'else', 'elseif', 'end', 'false', 'for',
  'function', 'if', 'in', 'local', 'nil', 'not', 'or', 'repeat',
  'return', 'then', 'true', 'until', 'while',
]);

const BINOPS = {
  'or': [1, 1],
  'and': [2, 2],
  '<': [3, 3], '>': [3, 3], '<=': [3, 3], '>=': [3, 3], '~=': [3, 3], '==': [3, 3],
  '..': [5, 4], // right-assoc
  '+': [6, 6], '-': [6, 6],
  '*': [7, 7], '/': [7, 7], '%': [7, 7],
  '^': [10, 9], // right-assoc
};

const UNOPS = { 'not': 8, '-': 8, '#': 8 };

// --- Lexer ---

class Lexer {
  constructor(source) {
    this.src = source;
    this.pos = 0;
    this.line = 1;
    this.tokens = [];
  }

  error(msg) {
    throw new Error(`Lex error at line ${this.line}: ${msg}`);
  }

  peek(n) {
    return this.src[this.pos + (n || 0)];
  }

  next() {
    return this.src[this.pos++];
  }

  eof() {
    return this.pos >= this.src.length;
  }

  tokenize() {
    while (!this.eof()) {
      const c = this.peek();

      // Whitespace
      if (c === '\n') { this.line++; this.pos++; continue; }
      if (c === ' ' || c === '\t' || c === '\r') { this.pos++; continue; }

      // Comment -- or --[[ ]]
      if (c === '-' && this.peek(1) === '-') {
        this.pos += 2;
        if (this.peek() === '[') {
          const level = this.tryLongBracketLevel();
          if (level >= 0) { this.readLongString(level); continue; }
        }
        // Line comment
        while (!this.eof() && this.peek() !== '\n') this.pos++;
        continue;
      }

      // Long string [[ ]] or [==[ ]==]
      if (c === '[') {
        const level = this.tryLongBracketLevel();
        if (level >= 0) {
          const value = this.readLongString(level);
          this.tokens.push({ type: TT.LONG_STRING, value, line: this.line });
          continue;
        }
      }

      // String
      if (c === '"' || c === "'") {
        this.tokens.push(this.readString(c));
        continue;
      }

      // Number
      if (this.isDigit(c) || (c === '.' && this.isDigit(this.peek(1)))) {
        this.tokens.push(this.readNumber());
        continue;
      }

      // Name or keyword
      if (this.isNameStart(c)) {
        const start = this.pos;
        while (this.isNameChar(this.peek())) this.pos++;
        const word = this.src.slice(start, this.pos);
        this.tokens.push({
          type: KEYWORDS.has(word) ? TT.KEYWORD : TT.NAME,
          value: word,
          line: this.line,
        });
        continue;
      }

      // Operators
      const two = this.src.slice(this.pos, this.pos + 2);
      const three = this.src.slice(this.pos, this.pos + 3);

      if (three === '...') { this.tokens.push({ type: TT.OP, value: '...', line: this.line }); this.pos += 3; continue; }

      if (['==', '~=', '<=', '>=', '..'].includes(two)) {
        // Check for '..' followed by '=' → not a valid 3-char op
        this.tokens.push({ type: TT.OP, value: two, line: this.line });
        this.pos += 2;
        continue;
      }

      if ('+-*/%^#<>=(){}[];:,.'.includes(c)) {
        this.tokens.push({ type: TT.OP, value: c, line: this.line });
        this.pos++;
        continue;
      }

      this.error(`unexpected character: '${c}'`);
    }

    this.tokens.push({ type: TT.EOF, value: null, line: this.line });
    return this.tokens;
  }

  isDigit(c) { return c >= '0' && c <= '9'; }
  isNameStart(c) { return (c >= 'a' && c <= 'z') || (c >= 'A' && c <= 'Z') || c === '_'; }
  isNameChar(c) { return this.isNameStart(c) || this.isDigit(c); }

  tryLongBracketLevel() {
    // At '['; check for [=*[
    if (this.peek() !== '[') return -1;
    let i = this.pos + 1;
    let level = 0;
    while (this.src[i] === '=') { level++; i++; }
    if (this.src[i] === '[') {
      this.pos = i + 1;
      return level;
    }
    return -1;
  }

  readLongString(level) {
    // Reads until ]==...==]
    const closePattern = ']' + '='.repeat(level) + ']';
    const end = this.src.indexOf(closePattern, this.pos);
    if (end === -1) this.error('unterminated long string');
    const value = this.src.slice(this.pos, end);
    this.pos = end + closePattern.length;
    return value;
  }

  readString(quote) {
    const startLine = this.line;
    this.pos++; // skip open quote
    let value = '';
    while (!this.eof()) {
      let c = this.next();
      if (c === quote) {
        return { type: TT.STRING, value, quote, line: startLine };
      }
      if (c === '\n') { this.line++; value += '\n'; continue; }
      if (c === '\\') {
        const esc = this.next();
        switch (esc) {
          case 'n': value += '\n'; break;
          case 't': value += '\t'; break;
          case 'r': value += '\r'; break;
          case '\\': value += '\\'; break;
          case '"': value += '"'; break;
          case "'": value += "'"; break;
          case 'a': value += '\x07'; break;
          case 'b': value += '\b'; break;
          case 'f': value += '\f'; break;
          case 'v': value += '\v'; break;
          case '0': case '1': case '2': case '3':
          case '4': case '5': case '6': case '7':
          case '8': case '9': {
            let num = esc;
            while (this.isDigit(this.peek()) && num.length < 3) num += this.next();
            value += String.fromCharCode(parseInt(num, 10));
            break;
          }
          default: value += esc;
        }
        continue;
      }
      value += c;
    }
    this.error('unterminated string');
  }

  readNumber() {
    const start = this.pos;
    // Hex
    if (this.peek() === '0' && (this.peek(1) === 'x' || this.peek(1) === 'X')) {
      this.pos += 2;
      while (/[0-9a-fA-F]/.test(this.peek())) this.pos++;
      const raw = this.src.slice(start, this.pos);
      return { type: TT.NUMBER, value: parseInt(raw, 16), raw, line: this.line };
    }
    // Decimal
    while (this.isDigit(this.peek())) this.pos++;
    if (this.peek() === '.') {
      this.pos++;
      while (this.isDigit(this.peek())) this.pos++;
    }
    if (this.peek() === 'e' || this.peek() === 'E') {
      this.pos++;
      if (this.peek() === '+' || this.peek() === '-') this.pos++;
      while (this.isDigit(this.peek())) this.pos++;
    }
    const raw = this.src.slice(start, this.pos);
    return { type: TT.NUMBER, value: parseFloat(raw), raw, line: this.line };
  }
}

// --- Parser ---

export class Parser {
  constructor(source) {
    this.tokens = new Lexer(source).tokenize();
    this.pos = 0;
  }

  error(msg, tok) {
    const t = tok || this.peek();
    throw new Error(`Parse error at line ${t.line}: ${msg} (got ${t.type} '${t.value}')`);
  }

  peek(n) {
    return this.tokens[this.pos + (n || 0)];
  }

  next() {
    return this.tokens[this.pos++];
  }

  is(value, type) {
    const t = this.peek();
    if (type && t.type !== type) return false;
    return t.value === value;
  }

  isKeyword(kw) {
    const t = this.peek();
    return t.type === TT.KEYWORD && t.value === kw;
  }

  isOp(op) {
    const t = this.peek();
    return t.type === TT.OP && t.value === op;
  }

  accept(value, type) {
    if (this.is(value, type)) { this.pos++; return true; }
    return false;
  }

  expect(value, type) {
    if (this.is(value, type)) return this.next();
    this.error(`expected '${value}'`);
  }

  expectName() {
    const t = this.peek();
    if (t.type !== TT.NAME) this.error('expected name');
    this.pos++;
    return t.value;
  }

  // --- Program ---

  parse() {
    const body = this.parseBlock();
    if (this.peek().type !== TT.EOF) this.error('expected end of input');
    return A.chunk(body);
  }

  parseBlock() {
    const stmts = [];
    while (this.peek().type !== TT.EOF) {
      const t = this.peek();
      if (t.type === TT.KEYWORD && ['end', 'else', 'elseif', 'until'].includes(t.value)) break;
      if (this.isOp(';')) { this.pos++; continue; }
      const stmt = this.parseStatement();
      if (stmt) stmts.push(stmt);
    }
    return A.block(stmts);
  }

  // --- Statements ---

  parseStatement() {
    const t = this.peek();

    if (t.type === TT.KEYWORD) {
      switch (t.value) {
        case 'local': return this.parseLocal();
        case 'if': return this.parseIf();
        case 'while': return this.parseWhile();
        case 'for': return this.parseFor();
        case 'repeat': return this.parseRepeat();
        case 'do': return this.parseDo();
        case 'function': return this.parseFunctionDecl();
        case 'return': return this.parseReturn();
        case 'break': this.pos++; return A.breakStatement();
      }
    }

    // Expression statement → assignment or call
    return this.parseExpressionStatement();
  }

  parseLocal() {
    this.expect('local');
    if (this.isKeyword('function')) {
      this.pos++;
      const name = this.expectName();
      const func = this.parseFunctionBody();
      return A.functionDecl(A.identifier(name), func.params, func.body, true);
    }
    const names = [A.identifier(this.expectName())];
    while (this.accept(',')) {
      names.push(A.identifier(this.expectName()));
    }
    let values = [];
    if (this.accept('=')) {
      values = this.parseExpressionList();
    }
    return A.local(names, values);
  }

  parseIf() {
    this.expect('if');
    const clauses = [];
    const cond = this.parseExpression();
    this.expect('then');
    const body = this.parseBlock();
    clauses.push({ condition: cond, body });
    while (this.isKeyword('elseif')) {
      this.pos++;
      const c = this.parseExpression();
      this.expect('then');
      const b = this.parseBlock();
      clauses.push({ condition: c, body: b });
    }
    let elseBody = null;
    if (this.isKeyword('else')) {
      this.pos++;
      elseBody = this.parseBlock();
    }
    this.expect('end');
    return A.ifStatement(clauses, elseBody);
  }

  parseWhile() {
    this.expect('while');
    const condition = this.parseExpression();
    this.expect('do');
    const body = this.parseBlock();
    this.expect('end');
    return A.whileStatement(condition, body);
  }

  parseRepeat() {
    this.expect('repeat');
    const body = this.parseBlock();
    this.expect('until');
    const condition = this.parseExpression();
    return A.repeatStatement(body, condition);
  }

  parseFor() {
    this.expect('for');
    const first = this.expectName();
    if (this.accept('=')) {
      const start = this.parseExpression();
      this.expect(',');
      const end = this.parseExpression();
      let step = null;
      if (this.accept(',')) step = this.parseExpression();
      this.expect('do');
      const body = this.parseBlock();
      this.expect('end');
      return A.forNumeric(A.identifier(first), start, end, step, body);
    }
    const variables = [A.identifier(first)];
    while (this.accept(',')) variables.push(A.identifier(this.expectName()));
    this.expect('in');
    const iterators = this.parseExpressionList();
    this.expect('do');
    const body = this.parseBlock();
    this.expect('end');
    return A.forGeneric(variables, iterators, body);
  }

  parseDo() {
    this.expect('do');
    const body = this.parseBlock();
    this.expect('end');
    return A.doStatement(body);
  }

  parseFunctionDecl() {
    this.expect('function');
    // Name, possibly with . and : for methods
    const parts = [this.expectName()];
    while (this.isOp('.')) {
      this.pos++;
      parts.push(this.expectName());
    }
    let isMethod = false;
    if (this.isOp(':')) {
      this.pos++;
      parts.push(this.expectName());
      isMethod = true;
    }
    const func = this.parseFunctionBody();
    const params = isMethod ? [A.identifier('self'), ...func.params] : func.params;
    return A.functionDecl(
      A.identifier(parts.join('.')),
      params,
      func.body,
      false,
    );
  }

  parseFunctionBody() {
    this.expect('(');
    const params = [];
    let isVararg = false;
    if (!this.isOp(')')) {
      if (this.isOp('...')) {
        this.pos++;
        isVararg = true;
      } else {
        params.push(A.identifier(this.expectName()));
        while (this.accept(',')) {
          if (this.isOp('...')) { this.pos++; isVararg = true; break; }
          params.push(A.identifier(this.expectName()));
        }
      }
    }
    this.expect(')');
    const body = this.parseBlock();
    this.expect('end');
    return { params, body, isVararg };
  }

  parseReturn() {
    this.expect('return');
    const values = [];
    if (!this.isOp(';') && !this.isKeyword('end') && !this.isKeyword('until')
        && !this.isKeyword('else') && !this.isKeyword('elseif')
        && this.peek().type !== TT.EOF) {
      values.push(...this.parseExpressionList());
    }
    this.accept(';');
    return A.returnStatement(values);
  }

  parseExpressionStatement() {
    const expr = this.parseSuffixedExpression();
    if (this.isOp('=') || this.isOp(',')) {
      const targets = [expr];
      while (this.accept(',')) {
        targets.push(this.parseSuffixedExpression());
      }
      this.expect('=');
      const values = this.parseExpressionList();
      return A.assign(targets, values);
    }
    if (expr.type === A.NodeType.CALL || expr.type === A.NodeType.METHOD_CALL) {
      return A.callStatement(expr);
    }
    this.error('expected assignment or function call');
  }

  // --- Expressions ---

  parseExpressionList() {
    const list = [this.parseExpression()];
    while (this.accept(',')) {
      list.push(this.parseExpression());
    }
    return list;
  }

  parseExpression(minPrec) {
    minPrec = minPrec || 0;
    let left = this.parseUnary();

    while (true) {
      const t = this.peek();
      if (t.type !== TT.OP && t.type !== TT.KEYWORD) break;
      const op = t.value;
      if (!BINOPS[op]) break;
      const [leftPrec, rightPrec] = BINOPS[op];
      if (leftPrec <= minPrec) break;
      this.pos++;
      const right = this.parseExpression(rightPrec);
      left = A.binary(left, op, right);
    }

    return left;
  }

  parseUnary() {
    const t = this.peek();
    if (t.type === TT.KEYWORD && t.value === 'not') {
      this.pos++;
      return A.unary('not', this.parseExpression(UNOPS['not']));
    }
    if (t.type === TT.OP && (t.value === '-' || t.value === '#')) {
      this.pos++;
      return A.unary(t.value, this.parseExpression(UNOPS[t.value]));
    }
    return this.parseSuffixedExpression();
  }

  parseSuffixedExpression() {
    let expr = this.parsePrimary();

    while (true) {
      if (this.isOp('.')) {
        this.pos++;
        const name = this.expectName();
        expr = A.index(expr, A.stringLiteral(name, '"'), false);
        continue;
      }
      if (this.isOp('[')) {
        this.pos++;
        const key = this.parseExpression();
        this.expect(']');
        expr = A.index(expr, key, true);
        continue;
      }
      if (this.isOp(':')) {
        this.pos++;
        const method = this.expectName();
        const args = this.parseCallArgs();
        expr = A.methodCall(expr, method, args);
        continue;
      }
      if (this.isOp('(') || this.peek().type === TT.STRING || this.peek().type === TT.LONG_STRING || this.isOp('{')) {
        const args = this.parseCallArgs();
        expr = A.call(expr, args);
        continue;
      }
      break;
    }

    return expr;
  }

  parseCallArgs() {
    if (this.isOp('(')) {
      this.pos++;
      const args = [];
      if (!this.isOp(')')) {
        args.push(...this.parseExpressionList());
      }
      this.expect(')');
      return args;
    }
    if (this.peek().type === TT.STRING || this.peek().type === TT.LONG_STRING) {
      return [this.parseStringLiteral()];
    }
    if (this.isOp('{')) {
      return [this.parseTable()];
    }
    this.error('expected function call arguments');
  }

  parsePrimary() {
    const t = this.peek();

    if (t.type === TT.NUMBER) {
      this.pos++;
      return A.numberLiteral(t.value, t.raw);
    }
    if (t.type === TT.STRING || t.type === TT.LONG_STRING) {
      return this.parseStringLiteral();
    }
    if (t.type === TT.NAME) {
      this.pos++;
      return A.identifier(t.value);
    }
    if (t.type === TT.KEYWORD) {
      if (t.value === 'nil') { this.pos++; return A.nilLiteral(); }
      if (t.value === 'true') { this.pos++; return A.boolLiteral(true); }
      if (t.value === 'false') { this.pos++; return A.boolLiteral(false); }
      if (t.value === 'function') {
        this.pos++;
        const func = this.parseFunctionBody();
        return A.functionExpr(func.params, func.body, func.isVararg);
      }
    }
    if (t.type === TT.OP) {
      if (t.value === '...') { this.pos++; return A.varargLiteral(); }
      if (t.value === '{') return this.parseTable();
      if (t.value === '(') {
        this.pos++;
        const expr = this.parseExpression();
        this.expect(')');
        return A.paren(expr);
      }
    }
    this.error('unexpected token in expression');
  }

  parseStringLiteral() {
    const t = this.next();
    return A.stringLiteral(t.value, t.quote || '"', t.value);
  }

  parseTable() {
    this.expect('{');
    const fields = [];
    while (!this.isOp('}')) {
      // [expr] = value
      if (this.isOp('[')) {
        this.pos++;
        const key = this.parseExpression();
        this.expect(']');
        this.expect('=');
        const value = this.parseExpression();
        fields.push({ type: 'key', key, value });
      }
      // Name = value
      else if (this.peek().type === TT.NAME && this.peek(1).type === TT.OP && this.peek(1).value === '=') {
        const name = this.expectName();
        this.expect('=');
        const value = this.parseExpression();
        fields.push({ type: 'key', key: A.stringLiteral(name, '"'), value });
      }
      // Array element
      else {
        fields.push({ type: 'array', value: this.parseExpression() });
      }

      if (!this.accept(',') && !this.accept(';')) break;
    }
    this.expect('}');
    return A.table(fields);
  }
}

export function parse(source) {
  return new Parser(source).parse();
}