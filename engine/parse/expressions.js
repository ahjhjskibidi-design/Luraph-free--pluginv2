/**
 * Expression parsing.
 *
 * Expressions in Lua are parsed with precedence climbing. The parser
 * starts with a primary expression (name, literal, table, function,
 * or parenthesized expression), then greedily applies suffixes (index,
 * call, method call), then applies binary operators according to
 * precedence.
 */

import * as A from './ast.js';
import { NODE } from './types.js';
import { getBinaryPrecedence, UNARY } from './precedence.js';
import { unexpected } from './errors.js';
import { TOKEN_TYPE } from '../lexer/token.js';

/**
 * Parse a comma-separated list of expressions.
 * Used by return, assignment, function calls, and local declarations.
 */
export function parseExpressionList(P) {
  const list = [parseExpression(P)];
  while (P.checkOp(',')) {
    P.next();
    list.push(parseExpression(P));
  }
  return list;
}

/**
 * Parse an expression with optional minimum precedence.
 */
export function parseExpression(P, minPrec) {
  minPrec = minPrec || 0;
  let left = parseUnary(P);

  for (;;) {
    const tok = P.peek();
    if (tok.type !== TOKEN_TYPE.OP && tok.type !== TOKEN_TYPE.KEYWORD) break;
    const op = tok.value;
    const prec = getBinaryPrecedence(op);
    if (!prec) break;
    const [leftPrec, rightPrec] = prec;
    if (leftPrec <= minPrec) break;
    P.next();
    const right = parseExpression(P, rightPrec);
    left = A.binaryExpression(left, op, right);
  }

  return left;
}

/**
 * Parse a unary expression: `not X`, `-X`, `#X`.
 * Unary operators are right-associative and have lower precedence than ^.
 */
export function parseUnary(P) {
  const tok = P.peek();
  if (tok.type === TOKEN_TYPE.KEYWORD && tok.value === 'not') {
    P.next();
    const arg = parseExpression(P, UNARY['not']);
    return A.unaryExpression('not', arg);
  }
  if (tok.type === TOKEN_TYPE.OP && (tok.value === '-' || tok.value === '#')) {
    P.next();
    const arg = parseExpression(P, UNARY[tok.value]);
    return A.unaryExpression(tok.value, arg);
  }
  return parseSuffixed(P);
}

/**
 * Parse a primary expression followed by any number of suffixes.
 * Suffixes are: `.name`, `[expr]`, `:method(args)`, `(args)`, `{table}`,
 * or a string literal used as a call argument.
 */
export function parseSuffixed(P) {
  let expr = parsePrimary(P);

  for (;;) {
    if (P.checkOp('.')) {
      P.next();
      const name = P.expectName();
      expr = A.indexExpression(expr, A.stringLiteral(name), false);
      continue;
    }
    if (P.checkOp('[')) {
      P.next();
      const key = parseExpression(P);
      P.expectOp(']');
      expr = A.indexExpression(expr, key, true);
      continue;
    }
    if (P.checkOp(':')) {
      P.next();
      const method = P.expectName();
      const args = parseCallArgs(P);
      expr = A.methodCall(expr, method, args);
      continue;
    }
    if (canStartCallArgs(P)) {
      const args = parseCallArgs(P);
      expr = A.callExpression(expr, args);
      continue;
    }
    break;
  }

  return expr;
}

/**
 * Can the next token begin a function call's argument list?
 * Called when we're looking for `(...)`, `{...}`, or a string literal
 * directly after an expression.
 */
export function canStartCallArgs(P) {
  const tok = P.peek();
  if (tok.type === TOKEN_TYPE.OP && tok.value === '(') return true;
  if (tok.type === TOKEN_TYPE.OP && tok.value === '{') return true;
  if (tok.type === TOKEN_TYPE.STRING) return true;
  return false;
}

/**
 * Parse the argument list of a function call.
 * Three forms: `(a, b, c)`, `{table}`, or `"string"`.
 */
export function parseCallArgs(P) {
  if (P.checkOp('(')) {
    P.next();
    const args = [];
    if (!P.checkOp(')')) {
      args.push(...parseExpressionList(P));
    }
    P.expectOp(')');
    return args;
  }
  if (P.peek().type === TOKEN_TYPE.STRING) {
    const tok = P.next();
    return [A.stringLiteral(tok.value)];
  }
  if (P.checkOp('{')) {
    return [parseTable(P)];
  }
  unexpected(P.peek(), 'call arguments');
}

/**
 * Parse a primary expression — the atoms of the language.
 */
export function parsePrimary(P) {
  const tok = P.peek();

  if (tok.type === TOKEN_TYPE.NUMBER) {
    P.next();
    return A.numberLiteral(tok.value);
  }
  if (tok.type === TOKEN_TYPE.STRING) {
    P.next();
    return A.stringLiteral(tok.value);
  }
  if (tok.type === TOKEN_TYPE.NAME) {
    P.next();
    return A.identifier(tok.value);
  }
  if (tok.type === TOKEN_TYPE.KEYWORD) {
    if (tok.value === 'nil') { P.next(); return A.nilLiteral(); }
    if (tok.value === 'true') { P.next(); return A.boolLiteral(true); }
    if (tok.value === 'false') { P.next(); return A.boolLiteral(false); }
    if (tok.value === 'function') {
      P.next();
      const func = parseFunctionBody(P);
      return A.functionExpression(func.params, func.body, func.isVararg);
    }
  }
  if (tok.type === TOKEN_TYPE.OP) {
    if (tok.value === '...') { P.next(); return A.varargLiteral(); }
    if (tok.value === '{') return parseTable(P);
    if (tok.value === '(') {
      P.next();
      const expr = parseExpression(P);
      P.expectOp(')');
      return A.parenExpression(expr);
    }
  }

  unexpected(tok, 'expression');
}

/**
 * Parse a table constructor: `{...}`.
 * Fields can be:
 *   `[key] = value`     — computed key
 *   `name = value`      — shorthand for `["name"] = value`
 *   `value`             — array element
 * Separators are `,` or `;`. Trailing separators are allowed.
 */
export function parseTable(P) {
  P.expectOp('{');
  const fields = [];

  while (!P.checkOp('}')) {
    if (P.checkOp('[')) {
      P.next();
      const key = parseExpression(P);
      P.expectOp(']');
      P.expectOp('=');
      const value = parseExpression(P);
      fields.push(A.keyField(key, value));
    } else if (
      P.peek().type === TOKEN_TYPE.NAME &&
      P.peek(1).type === TOKEN_TYPE.OP &&
      P.peek(1).value === '='
    ) {
      const name = P.expectName();
      P.expectOp('=');
      const value = parseExpression(P);
      fields.push(A.keyField(A.stringLiteral(name), value));
    } else {
      fields.push(A.arrayField(parseExpression(P)));
    }

    if (P.checkOp(',') || P.checkOp(';')) {
      P.next();
    } else {
      break;
    }
  }

  P.expectOp('}');
  return A.tableConstructor(fields);
}

/**
 * Parse a function body: parameter list + block + `end`.
 * Called from three places: primary expression (`function ... end`),
 * function declaration (`function name ... end`), and local function.
 */
export function parseFunctionBody(P) {
  P.expectOp('(');
  const params = [];
  let isVararg = false;

  if (!P.checkOp(')')) {
    if (P.checkOp('...')) {
      P.next();
      isVararg = true;
    } else {
      params.push(A.identifier(P.expectName()));
      while (P.checkOp(',')) {
        P.next();
        if (P.checkOp('...')) {
          P.next();
          isVararg = true;
          break;
        }
        params.push(A.identifier(P.expectName()));
      }
    }
  }

  P.expectOp(')');
  const body = P.parseBlock();
  P.expectKeyword('end');

  return { params, body, isVararg };
}

export default {
  parseExpressionList,
  parseExpression,
  parseUnary,
  parseSuffixed,
  parsePrimary,
  parseTable,
  parseFunctionBody,
  canStartCallArgs,
  parseCallArgs,
};