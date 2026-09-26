/**
 * Lua Obf — Multi-layer wrapper.
 * Wraps the final AST output in loadstring layers, VM entry, etc.
 */

import * as A from './ast.js';

// --- AST to Lua source (printer) ---

const INDENT = '  ';

function escapeString(value, quote) {
  quote = quote || '"';
  let out = '';
  for (let i = 0; i < value.length; i++) {
    const c = value[i];
    const code = value.charCodeAt(i);
    if (c === quote) out += '\\' + quote;
    else if (c === '\\') out += '\\\\';
    else if (c === '\n') out += '\\n';
    else if (c === '\r') out += '\\r';
    else if (c === '\t') out += '\\t';
    else if (code < 32 || code === 127) out += '\\' + code;
    else out += c;
  }
  return quote + out + quote;
}

function needsParens(node, parent, side) {
  if (!parent) return false;
  const P = A.NodeType;
  const N = node.type;
  // Binary children of binary need parens if precedence is lower
  if (parent.type === P.BINARY && N === P.BINARY) {
    // Conservative: always parenthesize nested binaries
    return true;
  }
  if (parent.type === P.UNARY && N === P.BINARY) return true;
  if (parent.type === P.INDEX && N === P.BINARY && side === 'object') return true;
  if (parent.type === P.CALL && N === P.BINARY && side === 'callee') return true;
  return false;
}

export function print(ast, indent) {
  indent = indent || 0;
  const pad = INDENT.repeat(indent);
  const lines = [];

  function p(node, level) {
    const lvl = level == null ? indent : level;
    const p = INDENT.repeat(lvl);
    return printNode(node, lvl);
  }

  function printNode(node, level) {
    if (!node || typeof node !== 'object') return '';

    switch (node.type) {
      case A.NodeType.CHUNK:
        return node.body.body.map(s => printStatement(s, level)).join('\n');
      case A.NodeType.BLOCK:
        return node.body.map(s => printStatement(s, level)).join('\n');
      default:
        return printExpression(node, level);
    }
  }

  function printStatement(node, level) {
    if (!node) return '';
    const p = INDENT.repeat(level);

    switch (node.type) {
      case A.NodeType.LOCAL:
        return p + 'local ' + node.names.map(n => n.name).join(', ')
          + (node.values.length ? ' = ' + node.values.map(v => printExpression(v, level)).join(', ') : '');

      case A.NodeType.ASSIGN:
        return p + node.targets.map(t => printExpression(t, level)).join(', ')
          + ' = ' + node.values.map(v => printExpression(v, level)).join(', ');

      case A.NodeType.CALL_STATEMENT:
        return p + printExpression(node.expression, level);

      case A.NodeType.IF: {
        const parts = [];
        for (let i = 0; i < node.clauses.length; i++) {
          const clause = node.clauses[i];
          const kw = i === 0 ? 'if' : 'elseif';
          parts.push(p + kw + ' ' + printExpression(clause.condition, level) + ' then');
          const body = clause.body.body.map(s => printStatement(s, level + 1)).join('\n');
          if (body) parts.push(body);
        }
        if (node.elseBody && node.elseBody.body.length > 0) {
          parts.push(p + 'else');
          const body = node.elseBody.body.map(s => printStatement(s, level + 1)).join('\n');
          if (body) parts.push(body);
        }
        parts.push(p + 'end');
        return parts.join('\n');
      }

      case A.NodeType.WHILE:
        return p + 'while ' + printExpression(node.condition, level) + ' do\n'
          + node.body.body.map(s => printStatement(s, level + 1)).join('\n')
          + '\n' + p + 'end';

      case A.NodeType.REPEAT:
        return p + 'repeat\n'
          + node.body.body.map(s => printStatement(s, level + 1)).join('\n')
          + '\n' + p + 'until ' + printExpression(node.condition, level);

      case A.NodeType.FOR_NUMERIC:
        return p + 'for ' + node.variable.name + ' = '
          + printExpression(node.start, level) + ', '
          + printExpression(node.end, level)
          + (node.step ? ', ' + printExpression(node.step, level) : '')
          + ' do\n'
          + node.body.body.map(s => printStatement(s, level + 1)).join('\n')
          + '\n' + p + 'end';

      case A.NodeType.FOR_GENERIC:
        return p + 'for ' + node.variables.map(v => v.name).join(', ') + ' in '
          + node.iterators.map(i => printExpression(i, level)).join(', ')
          + ' do\n'
          + node.body.body.map(s => printStatement(s, level + 1)).join('\n')
          + '\n' + p + 'end';

      case A.NodeType.RETURN:
        return p + 'return'
          + (node.values.length ? ' ' + node.values.map(v => printExpression(v, level)).join(', ') : '');

      case A.NodeType.BREAK:
        return p + 'break';

      case A.NodeType.DO:
        return p + 'do\n'
          + node.body.body.map(s => printStatement(s, level + 1)).join('\n')
          + '\n' + p + 'end';

      case A.NodeType.LOCAL_FUNCTION: {
        const params = node.params.map(pp => pp.name).join(', ');
        return p + 'local function ' + node.name.name + '(' + params + ')\n'
          + node.body.body.map(s => printStatement(s, level + 1)).join('\n')
          + '\n' + p + 'end';
      }

      case A.NodeType.FUNCTION_DECL: {
        const params = node.params.map(pp => pp.name).join(', ');
        return p + 'function ' + node.name.name + '(' + params + ')\n'
          + node.body.body.map(s => printStatement(s, level + 1)).join('\n')
          + '\n' + p + 'end';
      }

      default:
        // Expression statement
        return p + printExpression(node, level);
    }
  }

  function printExpression(node, level) {
    if (!node || typeof node !== 'object') return '';

    switch (node.type) {
      case A.NodeType.IDENTIFIER:
        return node.name;

      case A.NodeType.LITERAL_STRING:
        return escapeString(node.value, node.quote || '"');

      case A.NodeType.LITERAL_NUMBER:
        return node.raw || String(node.value);

      case A.NodeType.LITERAL_BOOL:
        return node.value ? 'true' : 'false';

      case A.NodeType.LITERAL_NIL:
        return 'nil';

      case A.NodeType.LITERAL_VARARG:
        return '...';

      case A.NodeType.BINARY: {
        const left = printExpression(node.left, level);
        const right = printExpression(node.right, level);
        const wrapLeft = needsParens(node.left, node, 'left');
        const wrapRight = needsParens(node.right, node, 'right');
        return (wrapLeft ? '(' + left + ')' : left) + ' ' + node.operator + ' ' + (wrapRight ? '(' + right + ')' : right);
      }

      case A.NodeType.UNARY: {
        const arg = printExpression(node.argument, level);
        const wrap = node.argument.type === A.NodeType.BINARY;
        const op = node.operator === 'not' ? 'not ' : node.operator;
        return op + (wrap ? '(' + arg + ')' : arg);
      }

      case A.NodeType.CALL: {
        const callee = printExpression(node.callee, level);
        const args = node.args.map(a => printExpression(a, level)).join(', ');
        return callee + '(' + args + ')';
      }

      case A.NodeType.METHOD_CALL: {
        const obj = printExpression(node.object, level);
        const args = node.args.map(a => printExpression(a, level)).join(', ');
        return obj + ':' + node.method + '(' + args + ')';
      }

      case A.NodeType.INDEX: {
        const obj = printExpression(node.object, level);
        if (node.computed) {
          return obj + '[' + printExpression(node.key, level) + ']';
        }
        return obj + '.' + node.key.value;
      }

      case A.NodeType.TABLE: {
        const items = node.fields.map(f => {
          if (f.type === 'key') {
            return '[' + printExpression(f.key, level) + '] = ' + printExpression(f.value, level);
          }
          return printExpression(f.value, level);
        });
        return '{' + items.join(', ') + '}';
      }

      case A.NodeType.FUNCTION_EXPR: {
        const params = node.params.map(pp => pp.name).join(', ');
        const varargSuffix = node.isVararg ? (params ? ', ...' : '...') : '';
        const body = node.body.body.map(s => printStatement(s, level + 1)).join('\n');
        return 'function(' + params + varargSuffix + ')\n' + body + '\n' + INDENT.repeat(level) + 'end';
      }

      case A.NodeType.PAREN:
        return '(' + printExpression(node.expression, level) + ')';

      default:
        return '--[[unknown:' + node.type + ']]';
    }
  }

  return printNode(ast, indent);
}

// --- Wrapper construction ---

/**
 * Wrap a Lua source string in N layers of loadstring.
 * Each layer just decodes and evals the next.
 */
function wrapInLayers(source, layers) {
  let current = source;
  for (let i = 0; i < layers; i++) {
    // Take the current source, encode it as a byte array, wrap it in loadstring(string.char(...))()
    const bytes = [];
    for (let j = 0; j < current.length; j++) {
      bytes.push(current.charCodeAt(j));
    }
    const bytesLiteral = bytes.join(',');

    // Build the wrapper
    current = [
      'local _c = {' + bytesLiteral + '}',
      'local _s = string.char(unpack(_c))',
      'local _f = loadstring(_s)',
      '_f()',
    ].join('\n');
  }
  return current;
}

/**
 * Wrap the final AST with a VM entry if configured.
 */
function buildVMEntry(ast, config) {
  // If useVM is on, print the AST into a Lua source string, then load it.
  const source = print(ast);
  return source;
}

export function wrap(ast, config) {
  let source = print(ast);

  if (config.wrapMultiLayer && config.wrapperLayers > 1) {
    // Outer layers
    source = wrapInLayers(source, config.wrapperLayers - 1);
  }

  // Final header comment
  const header = [
    '-- Obfuscated with Lua Obf',
    '-- Preset: ' + (config.label || 'unknown'),
    '-- ' + new Date().toISOString(),
    '',
  ].join('\n');

  return header + source;
}

export default { print, wrap };