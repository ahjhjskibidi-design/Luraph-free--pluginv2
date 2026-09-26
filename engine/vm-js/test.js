/**
 * VM test suite.
 *
 * Runs a series of small Lua programs through the full pipeline
 * (parse → compile → VM) and checks the output.
 *
 * Usage:
 *   node engine/vm-js/test.js
 */

import { parse } from '../parser/index.js';
import { compile } from '../compiler/index.js';
import { VM } from './index.js';

const TESTS = [
  {
    name: 'print literal string',
    source: 'print("hello")',
    expected: ['hello'],
  },
  {
    name: 'print number',
    source: 'print(42)',
    expected: ['42'],
  },
  {
    name: 'arithmetic',
    source: 'print(1 + 2)',
    expected: ['3'],
  },
  {
    name: 'string concat',
    source: 'print("a" .. "b")',
    expected: ['ab'],
  },
  {
    name: 'local variable',
    source: 'local x = 5\nprint(x)',
    expected: ['5'],
  },
  {
    name: 'multiple locals',
    source: 'local x, y = 3, 4\nprint(x + y)',
    expected: ['7'],
  },
  {
    name: 'if true branch',
    source: 'if 1 < 2 then print("yes") else print("no") end',
    expected: ['yes'],
  },
  {
    name: 'if false branch',
    source: 'if 2 < 1 then print("yes") else print("no") end',
    expected: ['no'],
  },
  {
    name: 'while loop',
    source: 'local i = 0\nwhile i < 3 do\nprint(i)\ni = i + 1\nend',
    expected: ['0', '1', '2'],
  },
  {
    name: 'simple function',
    source: 'local function f(a) return a + 1 end\nprint(f(10))',
    expected: ['11'],
  },
];

async function run() {
  let pass = 0;
  let fail = 0;

  for (const test of TESTS) {
    const actual = [];
    const io = { print: (line) => actual.push(line) };

    try {
      const ast = parse(test.source);
      const program = compile(ast);
      const vm = new VM(program, { io });
      vm.run();

      const actualJoined = actual.join('|');
      const expectedJoined = test.expected.join('|');

      if (actualJoined === expectedJoined) {
        console.log('PASS  ' + test.name);
        pass++;
      } else {
        console.log('FAIL  ' + test.name);
        console.log('      expected: ' + JSON.stringify(test.expected));
        console.log('      actual:   ' + JSON.stringify(actual));
        fail++;
      }
    } catch (err) {
      console.log('ERROR ' + test.name);
      console.log('      ' + err.message);
      fail++;
    }
  }

  console.log('');
  console.log('Total: ' + (pass + fail) + ', pass: ' + pass + ', fail: ' + fail);
  process.exit(fail > 0 ? 1 : 0);
}

run();