/**
 * Lexer errors — thrown when the input cannot be tokenized.
 *
 * Every error carries the line and column where it happened, so downstream
 * consumers (CLI, web UI) can point the user at the exact spot.
 */

export class LexError extends Error {
  constructor(message, line, col) {
    super(message);
    this.name = 'LexError';
    this.line = line;
    this.col = col;
  }

  format() {
    return `Lex error at line ${this.line}, col ${this.col}: ${this.message}`;
  }
}

/**
 * Throw a lex error at the current position of the lexer.
 * Called from the main loop when an unexpected character appears.
 */
export function lexError(line, col, message) {
  throw new LexError(message, line, col);
}

export default { LexError, lexError };