/**
 * Writer — accumulates output text with indentation tracking.
 *
 * The printer writes nodes into a Writer instead of concatenating
 * strings directly. This makes indentation, newlines, and multiline
 * formatting consistent.
 */

const INDENT = '  ';

export class Writer {
  constructor() {
    this.lines = [];
    this.currentLine = '';
    this.level = 0;
  }

  /** Write a raw string on the current line (no indentation, no newline). */
  write(text) {
    this.currentLine += text;
  }

  /** Write a string with a space before it if needed. */
  space() {
    if (this.currentLine.length > 0 && !this.currentLine.endsWith(' ')) {
      this.currentLine += ' ';
    }
  }

  /** Write a string then force a newline (with current indentation). */
  line(text) {
    if (text !== undefined) this.write(text);
    this.newline();
  }

  /** End the current line and start a new one at the current level. */
  newline() {
    this.lines.push(INDENT.repeat(this.level) + this.currentLine);
    this.currentLine = '';
  }

  /** Increase indent level for subsequent lines. */
  indent() {
    this.level++;
  }

  /** Decrease indent level. */
  dedent() {
    if (this.level > 0) this.level--;
  }

  /** Flush and return the final string, trimming trailing whitespace. */
  toString() {
    if (this.currentLine.length > 0) this.newline();
    return this.lines.join('\n').replace(/\s+$/, '') + '\n';
  }
}

export default Writer;