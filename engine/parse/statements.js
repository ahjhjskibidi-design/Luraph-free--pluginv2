/**
 * Statement parsing.
 *
 * Lua statements fall into two groups:
 *   1. Keyword-led: local, if, while, repeat, for, do, function, return, break
 *   2. Expression-led: `x = y`, `x, y = a, b`, `foo()`, `foo.bar:baz()`
 *
 * The `parseStatement` dispatcher decides which by looking at the first token.
 */

import * as A from './ast.js';
import { TOKEN_TYPE } from '../lexer/token.js';
import { unexpected, parseError } from './errors.js';
import {
  parseExpression,
  parseExpressionList,
  parseSuffixed,
  parseFunctionBody,
} from './expressions.js';

/**
 * Parse a single statement.
 */
export function parseStatement(P) {
  const tok = P.peek();

  if (tok.type === TOKEN_TYPE.KEYWORD) {
    switch (tok.value) {
      case 'local': return parseLocal(P);
      case 'if': return parseIf(P);
      case 'while': return parseWhile(P);
      case 'repeat': return parseRepeat(P);
      case 'for': return parseFor(P);
      case 'do': return parseDo(P);
      case 'function': return parseFunctionDecl(P);
      case 'return': return parseReturn(P);
      case 'break': P.next(); return A.breakStatement();
    }
  }

  return parseExpressionStatement(P);
}

/**
 * Local declaration: `local a, b = 1, 2` or `local function f() end`.
 */
function parseLocal(P) {
  P.expectKeyword('local');

  if (P.checkKeyword('function')) {
    P.next();
    const name = A.identifier(P.expectName());
    const func = parseFunctionBody(P);
    return A.functionDeclaration(name, func.params, func.body, true);
  }

  const names = [A.identifier(P.expectName())];
  while (P.checkOp(',')) {
    P.next();
    names.push(A.identifier(P.expectName()));
  }

  let values = [];
  if (P.checkOp('=')) {
    P.next();
    values = parseExpressionList(P);
  }

  return A.localStatement(names, values);
}

/**
 * If statement: `if cond then ... elseif ... else ... end`.
 * Every clause is stored as `{ condition, body }`. The else clause is
 * separate because it has no condition.
 */
function parseIf(P) {
  P.expectKeyword('if');
  const clauses = [];

  const firstCond = parseExpression(P);
  P.expectKeyword('then');
  const firstBody = P.parseBlock();
  clauses.push({ condition: firstCond, body: firstBody });

  while (P.checkKeyword('elseif')) {
    P.next();
    const cond = parseExpression(P);
    P.expectKeyword('then');
    const body = P.parseBlock();
    clauses.push({ condition: cond, body });
  }

  let elseBody = null;
  if (P.checkKeyword('else')) {
    P.next();
    elseBody = P.parseBlock();
  }

  P.expectKeyword('end');
  return A.ifStatement(clauses, elseBody);
}

/**
 * While loop: `while cond do ... end`.
 */
function parseWhile(P) {
  P.expectKeyword('while');
  const condition = parseExpression(P);
  P.expectKeyword('do');
  const body = P.parseBlock();
  P.expectKeyword('end');
  return A.whileStatement(condition, body);
}

/**
 * Repeat loop: `repeat ... until cond`.
 * The condition is evaluated AFTER each iteration and can see locals
 * declared inside the body.
 */
function parseRepeat(P) {
  P.expectKeyword('repeat');
  const body = P.parseBlock();
  P.expectKeyword('until');
  const condition = parseExpression(P);
  return A.repeatStatement(body, condition);
}

/**
 * Numeric or generic for-loop. Disambiguated by the token after the
 * first variable name: `=` means numeric, `,` or `in` means generic.
 */
function parseFor(P) {
  P.expectKeyword('for');
  const firstName = P.expectName();

  if (P.checkOp('=')) {
    P.next();
    const start = parseExpression(P);
    P.expectOp(',');
    const end = parseExpression(P);
    let step = null;
    if (P.checkOp(',')) {
      P.next();
      step = parseExpression(P);
    }
    P.expectKeyword('do');
    const body = P.parseBlock();
    P.expectKeyword('end');
    return A.numericFor(A.identifier(firstName), start, end, step, body);
  }

  const variables = [A.identifier(firstName)];
  while (P.checkOp(',')) {
    P.next();
    variables.push(A.identifier(P.expectName()));
  }

  P.expectKeyword('in');
  const iterators = parseExpressionList(P);
  P.expectKeyword('do');
  const body = P.parseBlock();
  P.expectKeyword('end');
  return A.genericFor(variables, iterators, body);
}

/**
 * Do block: `do ... end`.
 */
function parseDo(P) {
  P.expectKeyword('do');
  const body = P.parseBlock();
  P.expectKeyword('end');
  return A.doStatement(body);
}

/**
 * Function declaration: `function name(...) end` or
 * `function a.b.c(...) end` or `function a:b(...) end`.
 *
 * Method syntax `a:b()` inserts an implicit `self` as the first parameter.
 * The name is stored as a dotted string so downstream consumers don't
 * have to rebuild the chain.
 */
function parseFunctionDecl(P) {
  P.expectKeyword('function');

  const parts = [P.expectName()];
  while (P.checkOp('.')) {
    P.next();
    parts.push(P.expectName());
  }

  let isMethod = false;
  if (P.checkOp(':')) {
    P.next();
    parts.push(P.expectName());
    isMethod = true;
  }

  const func = parseFunctionBody(P);
  const params = isMethod
    ? [A.identifier('self'), ...func.params]
    : func.params;

  return A.functionDeclaration(
    A.identifier(parts.join('.')),
    params,
    func.body,
    false,
  );
}

/**
 * Return statement. Values are optional; `return` alone is valid.
 * Cannot have values if the next token is a block terminator.
 */
function parseReturn(P) {
  P.expectKeyword('return');
  const values = [];

  if (!isBlockTerminator(P.peek())) {
    values.push(...parseExpressionList(P));
  }

  if (P.checkOp(';')) P.next();

  return A.returnStatement(values);
}

function isBlockTerminator(tok) {
  if (tok.type === TOKEN_TYPE.EOF) return true;
  if (tok.type !== TOKEN_TYPE.KEYWORD) return false;
  return ['end', 'else', 'elseif', 'until'].includes(tok.value);
}

/**
 * Expression-led statement.
 * Can be:
 *   - A call: `foo()`, `foo.bar:baz(1, 2)`
 *   - An assignment: `x = 1`, `x, y = 1, 2`, `t[1] = x`
 *
 * If the expression is not a call and is not followed by `=`, it is an error.
 */
function parseExpressionStatement(P) {
  const first = parseSuffixed(P);

  if (P.checkOp(',') || P.checkOp('=')) {
    const targets = [first];
    while (P.checkOp(',')) {
      P.next();
      targets.push(parseSuffixed(P));
    }
    P.expectOp('=');
    const values = parseExpressionList(P);

    for (const t of targets) {
      if (t.type !== 'Identifier' && t.type !== 'IndexExpression') {
        parseError(P.peek(), 'cannot assign to this expression');
      }
    }

    return A.assignStatement(targets, values);
  }

  if (first.type === 'CallExpression' || first.type === 'MethodCallExpression') {
    return A.callStatement(first);
  }

  unexpected(P.peek(), 'assignment or function call');
}

export default {
  parseStatement,
  parseLocal,
  parseIf,
  parseWhile,
  parseRepeat,
  parseFor,
  parseDo,
  parseFunctionDecl,
  parseReturn,
  parseExpressionStatement,
};