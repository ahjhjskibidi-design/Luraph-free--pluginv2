/**
 * Token — the atomic unit the lexer produces.
 *
 * Every token has:
 *   type   — one of: 'Name', 'Keyword', 'Number', 'String', 'Op', 'EOF'
 *   value  — the semantic value. For strings this is the decoded content.
 *            For numbers this is a JS number. For EOF it is null.
 *   line   — 1-based line number in the source
 *   col    — 1-based column number in the source
 *
 * Tokens are plain objects — no class, no methods. They are created by
 * the `token()` factory below and pushed into the lexer's token stream.
 */

export const TOKEN_TYPE = {
  NAME: 'Name',
  KEYWORD: 'Keyword',
  NUMBER: 'Number',
  STRING: 'String',
  OP: 'Op',
  EOF: 'EOF',
};

/**
 * Create a token object.
 * Called for every token the lexer emits.
 */
export function token(type, value, line, col) {
  return { type, value, line, col };
}

/**
 * Check whether a token has a given type.
 * Convenience for parser code that receives a token and wants to test it.
 */
export function isType(tok, type) {
  return tok && tok.type === type;
}

/**
 * Human-readable description of a token, used in error messages.
 */
export function describe(tok) {
  if (!tok) return 'null';
  if (tok.type === TOKEN_TYPE.EOF) return 'end of input';
  if (tok.type === TOKEN_TYPE.STRING) {
    return `string ${JSON.stringify(tok.value)}`;
  }
  if (tok.type === TOKEN_TYPE.NUMBER) return `number ${tok.value}`;
  return `${tok.type} '${tok.value}'`;
}

export default { TOKEN_TYPE, token, isType, describe };