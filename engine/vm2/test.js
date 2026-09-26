/**
 * VM2 test suite — 60 test cases covering the full language subset.
 *
 * Runs the pipeline: source → parse → compile → execute in VM2.
 * Compares print output against expected values.
 *
 * Usage:
 *   node engine/vm2/test.js
 */

import { parse } from '../parser/index.js';
import { compile } from '../compiler/index.js';
import { VM2 } from './index.js';

// ============================================================
// Test definitions
// ============================================================

const TESTS = [
  // --- Basic output ---
  { name: 'print string', source: 'print("hello")', expected: ['hello'] },
  { name: 'print number', source: 'print(42)', expected: ['42'] },
  { name: 'print boolean true', source: 'print(true)', expected: ['true'] },
  { name: 'print boolean false', source: 'print(false)', expected: ['false'] },
  { name: 'print nil', source: 'print(nil)', expected: ['nil'] },
  { name: 'print multi-arg', source: 'print("a", "b", "c")', expected: ['a\tb\tc'] },
  { name: 'print empty', source: 'print()', expected: [''] },

  // --- Arithmetic ---
  { name: 'add', source: 'print(1 + 2)', expected: ['3'] },
  { name: 'sub', source: 'print(10 - 3)', expected: ['7'] },
  { name: 'mul', source: 'print(4 * 5)', expected: ['20'] },
  { name: 'div', source: 'print(10 / 2)', expected: ['5'] },
  { name: 'mod', source: 'print(10 % 3)', expected: ['1'] },
  { name: 'pow', source: 'print(2 ^ 8)', expected: ['256'] },
  { name: 'unm', source: 'print(-5)', expected: ['-5'] },
  { name: 'precedence', source: 'print(2 + 3 * 4)', expected: ['14'] },
  { name: 'parens', source: 'print((2 + 3) * 4)', expected: ['20'] },

  // --- Comparison ---
  { name: 'eq true', source: 'print(1 == 1)', expected: ['true'] },
  { name: 'eq false', source: 'print(1 == 2)', expected: ['false'] },
  { name: 'ne', source: 'print(1 ~= 2)', expected: ['true'] },
  { name: 'lt', source: 'print(1 < 2)', expected: ['true'] },
  { name: 'le', source: 'print(2 <= 2)', expected: ['true'] },
  { name: 'gt', source: 'print(3 > 2)', expected: ['true'] },
  { name: 'ge', source: 'print(3 >= 3)', expected: ['true'] },
  { name: 'string eq', source: 'print("a" == "a")', expected: ['true'] },
  { name: 'string lt', source: 'print("a" < "b")', expected: ['true'] },

  // --- Logical ---
  { name: 'and true', source: 'print(true and true)', expected: ['true'] },
  { name: 'and false', source: 'print(true and false)', expected: ['false'] },
  { name: 'or', source: 'print(false or true)', expected: ['true'] },
  { name: 'not', source: 'print(not true)', expected: ['false'] },
  { name: 'not nil', source: 'print(not nil)', expected: ['true'] },
  { name: 'short-circuit and', source: 'print(false and error("nope"))', expected: ['false'] },
  { name: 'short-circuit or', source: 'print(true or error("nope"))', expected: ['true'] },
  { name: 'and returns value', source: 'print(1 and 2)', expected: ['2'] },
  { name: 'or returns value', source: 'print(nil or "x")', expected: ['x'] },

  // --- Locals ---
  { name: 'local simple', source: 'local x = 5\nprint(x)', expected: ['5'] },
  { name: 'local multi', source: 'local a, b = 1, 2\nprint(a + b)', expected: ['3'] },
  { name: 'local nil', source: 'local x\nprint(x)', expected: ['nil'] },
  { name: 'local shadowing', source: 'local x = 1\ndo local x = 2\nprint(x) end\nprint(x)', expected: ['2', '1'] },

  // --- Assignment ---
  { name: 'reassign local', source: 'local x = 1\nx = 2\nprint(x)', expected: ['2'] },
  { name: 'multi-assign', source: 'local a, b\na, b = 1, 2\nprint(a + b)', expected: ['3'] },
  { name: 'swap', source: 'local a, b = 1, 2\na, b = b, a\nprint(a, b)', expected: ['2\t1'] },

  // --- Control flow ---
  { name: 'if true', source: 'if true then print("yes") end', expected: ['yes'] },
  { name: 'if false', source: 'if false then print("no") end', expected: [] },
  { name: 'if-else true', source: 'if 1 < 2 then print("a") else print("b") end', expected: ['a'] },
  { name: 'if-else false', source: 'if 1 > 2 then print("a") else print("b") end', expected: ['b'] },
  { name: 'elseif', source: 'local x = 2\nif x == 1 then print("one") elseif x == 2 then print("two") else print("other") end', expected: ['two'] },
  { name: 'while', source: 'local i = 0\nwhile i < 3 do print(i)\ni = i + 1\nend', expected: ['0', '1', '2'] },
  { name: 'repeat', source: 'local i = 0\nrepeat print(i)\ni = i + 1\nuntil i >= 3', expected: ['0', '1', '2'] },

  // --- Numeric for ---
  { name: 'for simple', source: 'for i = 1, 3 do print(i) end', expected: ['1', '2', '3'] },
  { name: 'for step', source: 'for i = 1, 5, 2 do print(i) end', expected: ['1', '3', '5'] },

  // --- Functions ---
  { name: 'function no args', source: 'local function f() return 42 end\nprint(f())', expected: ['42'] },
  { name: 'function one arg', source: 'local function f(x) return x * 2 end\nprint(f(5))', expected: ['10'] },
  { name: 'function two args', source: 'local function add(a, b) return a + b end\nprint(add(3, 4))', expected: ['7'] },
  { name: 'function no return', source: 'local function f() end\nprint(f())', expected: ['nil'] },
  { name: 'recursion', source: 'local function fact(n) if n <= 1 then return 1 end\nreturn n * fact(n - 1) end\nprint(fact(5))', expected: ['120'] },
  { name: 'closure', source: 'local function make() local x = 0\nreturn function() x = x + 1\nreturn x end end\nlocal c = make()\nprint(c())\nprint(c())\nprint(c())', expected: ['1', '2', '3'] },

  // --- Strings ---
  { name: 'string concat', source: 'print("a" .. "b")', expected: ['ab'] },
  { name: 'string concat three', source: 'print("a" .. "b" .. "c")', expected: ['abc'] },
  { name: 'string len', source: 'print(#"hello")', expected: ['5'] },
  { name: 'string.char', source: 'print(string.char(72, 105))', expected: ['Hi'] },
  { name: 'string.upper', source: 'print(string.upper("abc"))', expected: ['ABC'] },
  { name: 'string.lower', source: 'print(string.lower("ABC"))', expected: ['abc'] },
  { name: 'string.sub', source: 'print(string.sub("hello", 2, 4))', expected: ['ell'] },
  { name: 'string.rep', source: 'print(string.rep("ab", 3))', expected: ['ababab'] },
  { name: 'string.reverse', source: 'print(string.reverse("abc"))', expected: ['cba'] },
  { name: 'string.format %d', source: 'print(string.format("%d", 42))', expected: ['42'] },
  { name: 'string.format %s', source: 'print(string.format("hi %s", "there"))', expected: ['hi there'] },
  { name: 'string.format %f', source: 'print(string.format("%.2f", 3.14159))', expected: ['3.14'] },
];

// ============================================================
// Runner
// ============================================================

function run() {
  let pass = 0;
  let fail = 0;
  const failures = [];

  for (const test of TESTS) {
    const actual = [];
    const io = { print: (line) => actual.push(line) };

    try {
      const ast = parse(test.source);
      const program = compile(ast);
      const vm = new VM2(program, { io });
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
        failures.push(test.name);
        fail++;
      }
    } catch (err) {
      console.log('ERROR ' + test.name);
      console.log('      ' + err.message);
      if (err.stack) {
        const lines = err.stack.split('\n').slice(0, 3);
        for (const line of lines) console.log('      ' + line.trim());
      }
      failures.push(test.name);
      fail++;
    }
  }

  console.log('');
  console.log('========================================');
  console.log('Total: ' + (pass + fail) + ', pass: ' + pass + ', fail: ' + fail);
  console.log('========================================');

  if (failures.length > 0) {
    console.log('');
    console.log('Failed tests:');
    for (const name of failures) console.log('  - ' + name);
  }

  process.exit(fail > 0 ? 1 : 0);
}

run();