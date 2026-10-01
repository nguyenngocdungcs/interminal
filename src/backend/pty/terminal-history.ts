export interface ReadTerminalOptions {
  cursor?: number;
  limit?: number;
}

export interface ReadTerminalResult {
  text: string;
  cursor: number;
  has_more: boolean;
  total_lines: number;
}

export const MAX_BUFFER_LINES = 5000;
export const MAX_BUFFER_CHARS = 1000000;
export const MAX_PAGE_LIMIT = 500;

// ANSI and control sequence patterns (OSC, CSI, character set, and single-char escapes)
const ANSI_REGEX = /\x1B(?:\][^\x07\x1B]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|\([A-Z0-9]|[@-Z\\-_])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

export class TerminalHistory {
  // Rolling line buffer
  private lines: string[] = [];
  private currentLine = '';
  private startLineIndex = 0; // Absolute offset of the oldest line in the buffer
  private totalChars = 0;
  private hasPendingCR = false;

  private readonly maxLines: number;
  private readonly maxChars: number;
  private readonly maxPageLimit: number;

  constructor(options?: { maxLines?: number; maxChars?: number; maxPageLimit?: number }) {
    this.maxLines = options?.maxLines ?? MAX_BUFFER_LINES;
    this.maxChars = options?.maxChars ?? MAX_BUFFER_CHARS;
    this.maxPageLimit = options?.maxPageLimit ?? MAX_PAGE_LIMIT;
  }

  public reset(): void {
    this.lines = [];
    this.currentLine = '';
    this.startLineIndex = 0;
    this.totalChars = 0;
    this.hasPendingCR = false;
  }

  public append(data: string): void {
    const clean = stripAnsi(data);
    let i = 0;
    while (i < clean.length) {
      const ch = clean[i];

      if (ch === '\r') {
        // Check if this \r is part of a newline sequence (\r+\n)
        let crCount = 0;
        while (i + crCount < clean.length && clean[i + crCount] === '\r') {
          crCount++;
        }
        if (i + crCount < clean.length && clean[i + crCount] === '\n') {
          // We have \r+\n in the current chunk -> it's a newline
          this.hasPendingCR = false;
          this.commitLine();
          i += crCount + 1;
          continue;
        } else if (i + crCount === clean.length) {
          // \r reaches the end of the chunk; hold as pending CR in case next chunk starts with \n
          this.hasPendingCR = true;
          i += crCount;
          continue;
        } else {
          // Standalone \r followed by non-newline characters in the same chunk -> overwrite current line
          this.currentLine = '';
          this.hasPendingCR = false;
          i += crCount;
          continue;
        }
      }

      if (ch === '\n') {
        this.hasPendingCR = false;
        this.commitLine();
        i += 1;
        continue;
      }

      // Normal character (or \b backspace)
      if (this.hasPendingCR) {
        // We had a pending \r from the end of previous chunk, and current character is NOT \n or \r
        // So that was a true standalone \r (overwrite)
        this.currentLine = '';
        this.hasPendingCR = false;
      }

      if (ch === '\b') {
        this.currentLine = this.currentLine.slice(0, -1);
        i += 1;
      } else {
        this.currentLine += ch;
        i += 1;
      }
    }

    this.trimBuffer();
  }

  public read(options: ReadTerminalOptions = {}): ReadTerminalResult {
    const allLines = this.getAllLines();
    const totalLines = this.startLineIndex + allLines.length;
    const requestedLimit = typeof options.limit === 'number' && options.limit > 0
      ? Math.min(options.limit, this.maxPageLimit)
      : this.maxPageLimit;

    let cursor = typeof options.cursor === 'number' && Number.isInteger(options.cursor) && options.cursor >= 0
      ? options.cursor
      : this.startLineIndex;

    // If requested cursor is before the oldest retained line, clamp to startLineIndex
    if (cursor < this.startLineIndex) {
      cursor = this.startLineIndex;
    }

    if (cursor >= totalLines) {
      return {
        text: '',
        cursor: Math.max(0, totalLines - 1),
        has_more: false,
        total_lines: totalLines,
      };
    }

    const relativeStart = cursor - this.startLineIndex;
    const batch = allLines.slice(relativeStart, relativeStart + requestedLimit);
    const lastLineIndex = cursor + Math.max(0, batch.length - 1);
    const hasMore = (relativeStart + batch.length) < allLines.length;

    return {
      text: batch.join('\n'),
      cursor: lastLineIndex,
      has_more: hasMore,
      total_lines: totalLines,
    };
  }

  public getAllLines(): string[] {
    return this.currentLine ? [...this.lines, this.currentLine] : this.lines;
  }

  public getTotalLines(): number {
    return this.startLineIndex + this.getAllLines().length;
  }

  public getStartLineIndex(): number {
    return this.startLineIndex;
  }

  private commitLine(): void {
    this.lines.push(this.currentLine);
    this.totalChars += this.currentLine.length + 1;
    this.currentLine = '';
  }

  private trimBuffer(): void {
    while (this.lines.length > this.maxLines || (this.totalChars > this.maxChars && this.lines.length > 1)) {
      const removed = this.lines.shift();
      if (removed !== undefined) {
        this.totalChars -= (removed.length + 1);
        this.startLineIndex += 1;
      }
    }
  }
}
