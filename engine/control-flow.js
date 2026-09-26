/**
 * Lua Obf — Control flow transformation.
 * Flattens simple statement blocks into a state-machine loop.
 * Only applied when preset.flattenControlFlow is true.
 */

import * as A from './ast.js';

/**
 * Flatten a block of statements into a while-loop with a state variable.
 * Only flattens top-level statements of a block; nested blocks are left alone.
 *
 * Input:
 *   local a = 1
 *   local b = 2
 *   print(a + b)
 *
 * Output:
 *   local _state = 1
 *   while _state ~= 0 do
 *     if _state == 1 then
 *       local a = 1
 *       _state = 2
 *     elseif _state == 2 then
 *       local b = 2
 *       _state = 3
 *     elseif _state == 3 then
 *       print(a + b)
 *       _state = 0
 *     end
 *   end
 *
 * NOTE: this is a naive transformation. It breaks in the presence of:
 *   - `return` statements (must be preserved)
 *   - `break` statements
 *   - local variables declared and used across statements
 *   - goto/labels
 *
 * For heavy preset, use it only on blocks without local declarations that
 * span multiple statements. Otherwise fall through unchanged.
 */

function canFlattenBlock(block) {
  if (!block || !block.body) return false;
  if (block.body.length < 3) return false;

  // Check for statements that prevent safe flattening
  for (const stmt of block.body) {
    if (!stmt || !stmt.type) continue;
    if (stmt.type === A.NodeType.RETURN) return false;
    if (stmt.type === A.NodeType.BREAK) return false;
    if (stmt.type === A.NodeType.LOCAL && stmt.names && stmt.names.length > 0) {
      // Local declarations would go out of scope in the flattened loop.
      // Skip flattening blocks with locals.
      return false;
    }
    if (stmt.type === A.NodeType.LOCAL_FUNCTION) return false;
  }

  return true;
}

function flattenBlock(block, config, nameGen) {
  if (!canFlattenBlock(block)) return block;

  const stateVar = nameGen.next();

  const clauses = [];
  for (let i = 0; i < block.body.length; i++) {
    const stmt = block.body[i];
    const nextState = i === block.body.length - 1 ? 0 : i + 2;

    // Build assignment: _state = <next>
    const advance = A.assign(
      [A.identifier(stateVar)],
      [A.numberLiteral(nextState, String(nextState))],
    );

    clauses.push({
      condition: A.binary(
        A.identifier(stateVar),
        '==',
        A.numberLiteral(i + 1, String(i + 1)),
      ),
      body: A.block([stmt, advance]),
    });
  }

  const whileBody = A.block([
    A.ifStatement(clauses, null),
  ]);

  const whileNode = A.whileStatement(
    A.binary(
      A.identifier(stateVar),
      '~=',
      A.numberLiteral(0, '0'),
    ),
    whileBody,
  );

  const initState = A.local(
    [A.identifier(stateVar)],
    [A.numberLiteral(1, '1')],
  );

  return A.block([initState, whileNode]);
}

class ControlFlowFlattener {
  constructor(config) {
    this.config = config;
    this.nameGen = {
      counter: 0,
      next: function () {
        this.counter++;
        return '_sm' + this.counter.toString(36) + Math.random().toString(36).slice(2, 6);
      },
    };
  }

  flatten(node) {
    if (!node || typeof node !== 'object') return node;

    // Recurse into children first
    for (const key of Object.keys(node)) {
      if (key === 'type') continue;
      const value = node[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          value[i] = this.flatten(value[i]);
        }
      } else if (value && typeof value === 'object' && value.type) {
        node[key] = this.flatten(value);
      }
    }

    // Then flatten blocks
    if (node.type === A.NodeType.BLOCK) {
      return flattenBlock(node, this.config, this.nameGen);
    }

    return node;
  }
}

export function flattenControlFlow(ast, config) {
  if (!config.flattenControlFlow) return ast;
  const flattener = new ControlFlowFlattener(config);
  return flattener.flatten(ast);
}