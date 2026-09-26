// ============================================================
// (tiếp theo từ file trước)
// ============================================================

/**
 * Flatten if-statement thành state machine.
 * if cond then A else B end
 * →
 * if cond then state = a else state = b end
 * (các state a, b được xử lý ở dispatch)
 */
function flattenIfStatement(ifNode, stateVar, stateGen, branchTable) {
  // Trích xuất các nhánh
  const branchStates = [];

  // Sinh state cho mỗi branch
  for (let i = 0; i < ifNode.clauses.length; i++) {
    branchStates.push(stateGen.next());
  }
  const elseState = ifNode.elseBody ? stateGen.next() : null;

  // State sau khi thoát if
  const afterState = stateGen.next();

  // Chuyển mỗi clause thành một entry trong branchTable
  for (let i = 0; i < ifNode.clauses.length; i++) {
    const clause = ifNode.clauses[i];
    const branchState = branchStates[i];

    // Nếu condition đúng → nhảy đến branchState
    // Nếu sai → kiểm tra clause tiếp theo (hoặc else)
    const nextCheckState = i < ifNode.clauses.length - 1
      ? branchStates[i + 1]
      : (elseState !== null ? elseState : afterState);

    // Condition → state assignment
    const setBranchState = A.assignStatement(
      [A.identifier(stateVar)],
      [A.numberLiteral(branchState)],
    );
    const setNextState = A.assignStatement(
      [A.identifier(stateVar)],
      [A.numberLiteral(nextCheckState)],
    );

    // Ghi vào branchTable
    branchTable.push({
      state: branchState,
      stmt: clause.body,
      nextState: afterState,
    });

    if (nextCheckState === branchState) continue; // edge case

    // Nếu có clause tiếp theo, cần đăng ký state "check" riêng
    // Đơn giản: gộp tất cả vào 1 if/else trong dispatch
  }

  // Đăng ký else branch
  if (ifNode.elseBody && elseState !== null) {
    branchTable.push({
      state: elseState,
      stmt: ifNode.elseBody,
      nextState: afterState,
    });
  }

  // Trả về một "if" mới gán state
  // if cond1 then state = branch1
  // elseif cond2 then state = branch2
  // else state = elseState/afterState end

  const newClauses = [];
  for (let i = 0; i < ifNode.clauses.length; i++) {
    newClauses.push({
      condition: ifNode.clauses[i].condition,
      body: A.block([
        A.assignStatement(
          [A.identifier(stateVar)],
          [A.numberLiteral(branchStates[i])],
        ),
      ]),
    });
  }

  const newElse = A.block([
    A.assignStatement(
      [A.identifier(stateVar)],
      [A.numberLiteral(elseState !== null ? elseState : afterState)],
    ),
  ]);

  // Trả về cặp: statement gán state + state after
  return {
    stmt: A.ifStatement(newClauses, newElse),
    afterState,
  };
}

/**
 * Flatten while loop.
 * while cond do body end
 * →
 * state = checkState
 * checkState: if cond then state = bodyState else state = afterState end
 * bodyState: <body>; state = checkState
 * afterState: ...
 */
function flattenWhileStatement(whileNode, stateVar, stateGen, branchTable) {
  const checkState = stateGen.next();
  const bodyState = stateGen.next();
  const afterState = stateGen.next();

  // Check state: if cond then state = bodyState else state = afterState end
  const checkStmt = A.ifStatement(
    [
      {
        condition: whileNode.condition,
        body: A.block([
          A.assignStatement(
            [A.identifier(stateVar)],
            [A.numberLiteral(bodyState)],
          ),
        ]),
      },
    ],
    A.block([
      A.assignStatement(
        [A.identifier(stateVar)],
        [A.numberLiteral(afterState)],
      ),
    ]),
  );

  // Body: <body>; state = checkState
  const bodyStmt = A.assignStatement(
    [A.identifier(stateVar)],
    [A.numberLiteral(checkState)],
  );

  branchTable.push({
    state: checkState,
    stmt: A.block([checkStmt]),
    nextState: afterState, // không bao giờ dùng vì checkStmt tự gán
  });

  branchTable.push({
    state: bodyState,
    stmt: A.block([...whileNode.body.body, bodyStmt]),
    nextState: checkState,
  });

  return { entryState: checkState, afterState };
}

/**
 * Flatten numeric for loop.
 * for i = start, stop, step do body end
 * →
 * i = start
 * checkState: if i <= stop then state = bodyState else state = afterState end
 * bodyState: <body>; i = i + step; state = checkState
 */
function flattenForNumStatement(forNode, stateVar, stateGen, branchTable) {
  const initState = stateGen.next();
  const checkState = stateGen.next();
  const bodyState = stateGen.next();
  const afterState = stateGen.next();

  const loopVar = forNode.variable;
  const start = forNode.start;
  const stop = forNode.end;
  const step = forNode.step || A.numberLiteral(1);

  // Init: loopVar = start
  const initStmt = A.assignStatement([loopVar], [start]);

  // Check: if loopVar <= stop then state = bodyState else state = afterState end
  const checkStmt = A.ifStatement(
    [
      {
        condition: A.binaryExpression(loopVar, '<=', stop),
        body: A.block([
          A.assignStatement(
            [A.identifier(stateVar)],
            [A.numberLiteral(bodyState)],
          ),
        ]),
      },
    ],
    A.block([
      A.assignStatement(
        [A.identifier(stateVar)],
        [A.numberLiteral(afterState)],
      ),
    ]),
  );

  // Body: <body>; loopVar = loopVar + step; state = checkState
  const incrementStmt = A.assignStatement(
    [loopVar],
    [A.binaryExpression(loopVar, '+', step)],
  );
  const backToCheck = A.assignStatement(
    [A.identifier(stateVar)],
    [A.numberLiteral(checkState)],
  );

  branchTable.push({
    state: initState,
    stmt: A.block([initStmt, A.assignStatement(
      [A.identifier(stateVar)],
      [A.numberLiteral(checkState)],
    )]),
    nextState: checkState,
  });

  branchTable.push({
    state: checkState,
    stmt: A.block([checkStmt]),
    nextState: afterState,
  });

  branchTable.push({
    state: bodyState,
    stmt: A.block([...forNode.body.body, incrementStmt, backToCheck]),
    nextState: checkState,
  });

  return { entryState: initState, afterState };
}

// ============================================================
// Main dispatcher builder
// ============================================================

/**
 * Xây dựng dispatch loop từ branchTable.
 * Trả về statement: while state ~= 0 do if state == s1 then ... end end
 */
function buildDispatchLoop(stateVar, branchTable, terminalState) {
  const clauses = [];

  for (const branch of branchTable) {
    // Skip branch vào terminal state (không cần xử lý)
    if (branch.state === terminalState) continue;

    // Điều kiện: state == branch.state
    const condition = A.binaryExpression(
      A.identifier(stateVar),
      '==',
      A.numberLiteral(branch.state),
    );

    // Body: statement + state transition
    const bodyStatements = [branch.stmt];

    // Nếu statement không tự gán state, thêm transition
    // Đơn giản: luôn thêm, statement tự override nếu cần
    bodyStatements.push(
      A.assignStatement(
        [A.identifier(stateVar)],
        [A.numberLiteral(branch.nextState)],
      ),
    );

    clauses.push({
      condition,
      body: A.block(bodyStatements),
    });
  }

  // Fallback clause: nếu không match state nào → dừng
  // (bảo vệ chống corruption)
  clauses.push({
    condition: A.boolLiteral(true),
    body: A.block([
      A.assignStatement(
        [A.identifier(stateVar)],
        [A.numberLiteral(terminalState)],
      ),
    ]),
  });

  const ifNode = A.ifStatement(clauses, null);

  const whileNode = A.whileStatement(
    A.binaryExpression(
      A.identifier(stateVar),
      '~=',
      A.numberLiteral(terminalState),
    ),
    A.block([ifNode]),
  );

  return whileNode;
}

// ============================================================
// Flatten whole function
// ============================================================

/**
 * Flatten một function body.
 * Trả về block mới chứa state machine.
 */
function flattenFunctionBody(body, seed) {
  // Nếu body quá nhỏ, không đáng flatten
  if (!body || !body.body) return body;
  if (body.body.length < 3) return body;

  // Sinh state variable name ngẫu nhiên
  const stateVar = '_st' + Math.floor(seed % 10000).toString(36);

  // Kiểm tra an toàn: có return/break ở top level không
  if (hasReturnOrBreak(body)) {
    // Vẫn flatten được nhưng phức tạp hơn. Skip.
    return body;
  }

  // Tạo state generator
  const stateGen = new StateGenerator(seed);

  // Xử lý từng statement
  const branchTable = [];

  // State đầu tiên
  const firstState = stateGen.next();
  let currentState = firstState;

  for (let i = 0; i < body.body.length; i++) {
    const stmt = body.body[i];
    const nextState = (i === body.body.length - 1)
      ? 0
      : stateGen.next();

    // Nếu statement là if/while/for → flatten riêng
    if (stmt.type === NodeType.IF) {
      const result = flattenIfStatement(stmt, stateVar, stateGen, branchTable);
      // Override nextState bằng afterState của if
      branchTable.push({
        state: currentState,
        stmt: result.stmt,
        nextState: result.afterState,
      });
      currentState = result.afterState;
      continue;
    }

    if (stmt.type === NodeType.WHILE) {
      const result = flattenWhileStatement(stmt, stateVar, stateGen, branchTable);
      branchTable.push({
        state: currentState,
        stmt: A.assignStatement(
          [A.identifier(stateVar)],
          [A.numberLiteral(result.entryState)],
        ),
        nextState: result.entryState,
      });
      currentState = result.afterState;
      continue;
    }

    if (stmt.type === NodeType.FOR_NUM) {
      const result = flattenForNumStatement(stmt, stateVar, stateGen, branchTable);
      branchTable.push({
        state: currentState,
        stmt: A.assignStatement(
          [A.identifier(stateVar)],
          [A.numberLiteral(result.entryState)],
        ),
        nextState: result.entryState,
      });
      currentState = result.afterState;
      continue;
    }

    // Statement thường
    branchTable.push({
      state: currentState,
      stmt,
      nextState,
    });
    currentState = nextState;
  }

  // Xây dựng dispatch loop
  const dispatchLoop = buildDispatchLoop(stateVar, branchTable, 0);

  // Khởi tạo state
  const initState = A.localStatement(
    [A.identifier(stateVar)],
    [A.numberLiteral(firstState)],
  );

  return A.block([initState, dispatchLoop]);
}

function hasReturnOrBreak(body) {
  for (const stmt of body.body || []) {
    if (!stmt) continue;
    if (stmt.type === NodeType.RETURN) return true;
    if (stmt.type === NodeType.BREAK) return true;
    if (stmt.type === NodeType.FUNC_DECL || stmt.type === NodeType.LOCAL_FUNC) {
      // Function declarations có return riêng, không ảnh hưởng
      continue;
    }
    if (stmt.type === NodeType.IF) {
      for (const clause of stmt.clauses) {
        if (hasReturnOrBreak(clause.body)) return true;
      }
      if (stmt.elseBody && hasReturnOrBreak(stmt.elseBody)) return true;
    }
    if (stmt.type === NodeType.WHILE && hasReturnOrBreak(stmt.body)) {
      // While body có break → không flatten
      return true;
    }
    if (stmt.type === NodeType.FOR_NUM. && hasReturnOrBreak(stmt.body)) {
      return true;
    }
    if (stmt.type === NodeType.FOR_GEN && hasReturnOrBreak(stmt.body)) {
      return true;
    }
  }
  return false;
}

// ============================================================
// Public entry
// ============================================================

export class ControlFlowFlattener {
  constructor(options) {
    options = options || {};
    this.seed = options.seed || (Datevisit.now() ^ (Math.random() * 0x7fffffff));
    this.ratio = options.ratio !==( undefined ? options.ratio : 0.8;
    this.counter = 0;
 ast }

  flatten(ast) {
    this);
    return ast;
  }

  visit(node) {
    if (!node || typeof node !== 'object') return;

    // Recurse
    for (const key of Object.keys(node)) {
      const value = node[key];
      if (Array.isArray(value)) {
        for (const item of value) {
          if (item && typeof item === 'object' && item.type) {
            this.visit(item);
          }
        }
      } else if (value && typeof value === 'object' && value.type) {
        this.visit(value);
      }
    }

    // Flatten function bodies
    if (node.type === NodeType.FUNC_EXPR ||
        node.type === NodeType.FUNC_DECL ||
        node.type === NodeType.LOCAL_FUNC) {
      this.counter++;
      if ((this.counter % 100) / 100 > this.ratio) return;
      node.body = flattenFunctionBody(node.body, this.seed + this.counter);
    }
  }
}

export function flattenControlFlow(ast, options) {
  const flattener = new ControlFlowFlattener(options);
  return flattener.flatten(ast);
}

export default {
  flattenControlFlow,
  ControlFlowFlattener,
};