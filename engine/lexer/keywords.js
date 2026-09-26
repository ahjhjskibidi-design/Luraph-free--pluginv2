/**
 * Lua 5.1 reserved keywords.
 *
 * These cannot be used as identifiers. The lexer emits them with type
 * 'Keyword' instead of 'Name', and the parser dispatches on the value.
 *
 * Note: Lua 5.2 added `goto`; Lua 5.4 added nothing new.
 * Luau (Roblox) adds `continue` but the lexer treats it as an identifier
 * and lets the parser decide what to do with it.
 */

export const KEYWORDS = new Set([
  'and',
  'break',
  'do',
  'else',
  'elseif',
  'end',
  'false',
  'for',
  'function',
  'if',
  'in',
  'local',
  'nil',
  'not',
  'or',
  'repeat',
  'return',
  'then',
  'true',
  'until',
  'while',
]);

/**
 * True if the given identifier is a reserved Lua keyword.
 */
export function isKeyword(word) {
  return KEYWORDS.has(word);
}

export default { KEYWORDS, isKeyword };