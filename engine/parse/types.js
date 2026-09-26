/**
 * AST node types.
 *
 * Every node in the tree has a `type` field matching one of these
 * constants. The printer, compiler, and transformer all dispatch on
 * this field.
 */

export const NODE = {
  // Root
  CHUNK: 'Chunk',
  BLOCK: 'Block',

  // Statements
  LOCAL: 'LocalStatement',
  ASSIGN: 'AssignStatement',
  CALL_STMT: 'CallStatement',
  IF: 'IfStatement',
  WHILE: 'WhileStatement',
  REPEAT: 'RepeatStatement',
  FOR_NUM: 'NumericForStatement',
  FOR_GEN: 'GenericForStatement',
  DO: 'DoStatement',
  RETURN: 'ReturnStatement',
  BREAK: 'BreakStatement',
  FUNC_DECL: 'FunctionDeclaration',
  LOCAL_FUNC: 'LocalFunctionDeclaration',

  // Expressions
  IDENT: 'Identifier',
  STRING: 'StringLiteral',
  NUMBER: 'NumberLiteral',
  BOOL: 'BoolLiteral',
  NIL: 'NilLiteral',
  VARARG: 'VarargLiteral',
  BINARY: 'BinaryExpression',
  UNARY: 'UnaryExpression',
  CALL: 'CallExpression',
  METHOD_CALL: 'MethodCallExpression',
  INDEX: 'IndexExpression',
  TABLE: 'TableConstructor',
  FUNC_EXPR: 'FunctionExpression',
  PAREN: 'ParenExpression',

  // Table fields
  FIELD_KEY: 'KeyField',
  FIELD_ARRAY: 'ArrayField',
};

export default NODE;