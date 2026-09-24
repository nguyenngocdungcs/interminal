import * as pty from 'node-pty';
import { EventEmitter } from 'events';

export type SessionType = 'local' | 'ssh';

export interface SessionStatus {
  sessionType: SessionType;
  target?: string;
  pid: number;
  cols: number;
  rows: number;
}

export interface ReadTerminalOptions {
  cursor?: number;
  limit?: number;
}

export interface ReadTerminalResult {
  text: string;
  cursor: number;
  has_more: boolean;
  total_lines: number;
  session: SessionStatus;
}

const MAX_BUFFER_LINES = 5000;
const MAX_BUFFER_CHARS = 1000000;
const MAX_PAGE_LIMIT = 500;

// ANSI and control sequence patterns (OSC, CSI, character set, and single-char escapes)
const ANSI_REGEX = /\x1B(?:\][^\x07\x1B]*(?:\x07|\x1B\\)|\[[0-?]*[ -/]*[@-~]|\([A-Z0-9]|[@-Z\\-_])/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_REGEX, '');
}

export class PtyManager extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private sessionType: SessionType = 'local';
  private target?: string;
  private cols = 80;
  private rows = 24;

  // Rolling line buffer
  private lines: string[] = [];
  private currentLine = '';
  private startLineIndex = 0; // Absolute offset of the oldest line in the buffer
  private totalChars = 0;
  private hasPendingCR = false;

  public spawnSession(type: SessionType = 'local', target?: string): SessionStatus {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch {
        // Ignore cleanup errors while replacing a session.
      }
      this.ptyProcess = null;
    }

    this.sessionType = type;
    this.target = target;
    this.resetBuffer();

    const shell = process.platform === 'win32'
      ? 'powershell.exe'
      : (process.env.SHELL || '/bin/zsh');
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };

    if (type === 'ssh' && target) {
      const sshArgs = target.split(' ').filter(Boolean);
      this.ptyProcess = pty.spawn('ssh', sshArgs, {
        name: 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
        env,
      });
    } else {
      let workingDir = process.env.HOME || '/';
      try {
        workingDir = process.cwd();
      } catch {
        // Fall back when the parent process has an invalid cwd.
      }
      this.ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
        cwd: workingDir,
        env,
      });
    }

    const sessionPty = this.ptyProcess;
    sessionPty.onData((data: string) => {
      if (this.ptyProcess !== sessionPty) {
        return;
      }
      this.emit('data', data);
      this.appendRawData(data);
    });

    sessionPty.onExit(({ exitCode, signal }) => {
      if (this.ptyProcess !== sessionPty) {
        return;
      }
      this.emit('exit', { exitCode, signal });
      this.ptyProcess = null;
    });

    return this.getStatus();
  }

  public write(data: string): void {
    this.ptyProcess?.write(data);
  }

  public writeToTerminal(input: string, autoEnter = true): void {
    if (!this.ptyProcess) {
      this.spawnSession(this.sessionType, this.target);
    }
    const formatted = autoEnter && !/[\r\n]$/.test(input) ? `${input}\n` : input;
    this.write(formatted);
  }

  public readTerminal(options: ReadTerminalOptions = {}): ReadTerminalResult {
    const allLines = this.getAllLines();
    const totalLines = this.startLineIndex + allLines.length;
    const requestedLimit = typeof options.limit === 'number' && options.limit > 0
      ? Math.min(options.limit, MAX_PAGE_LIMIT)
      : MAX_PAGE_LIMIT;

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
        session: this.getStatus(),
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
      session: this.getStatus(),
    };
  }

  public resize(cols: number, rows: number): void {
    this.cols = Math.max(10, cols);
    this.rows = Math.max(5, rows);
    if (this.ptyProcess) {
      try {
        this.ptyProcess.resize(this.cols, this.rows);
      } catch {
        // Ignore resize while the PTY is transitioning.
      }
    }
  }

  public getStatus(): SessionStatus {
    return {
      sessionType: this.sessionType,
      target: this.target,
      pid: this.ptyProcess?.pid ?? -1,
      cols: this.cols,
      rows: this.rows,
    };
  }

  private resetBuffer(): void {
    this.lines = [];
    this.currentLine = '';
    this.startLineIndex = 0;
    this.totalChars = 0;
    this.hasPendingCR = false;
  }

  private getAllLines(): string[] {
    return this.currentLine ? [...this.lines, this.currentLine] : this.lines;
  }

  public appendRawData(data: string): void {
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

  private commitLine(): void {
    this.lines.push(this.currentLine);
    this.totalChars += this.currentLine.length + 1;
    this.currentLine = '';
  }

  private trimBuffer(): void {
    while (this.lines.length > MAX_BUFFER_LINES || (this.totalChars > MAX_BUFFER_CHARS && this.lines.length > 1)) {
      const removed = this.lines.shift();
      if (removed !== undefined) {
        this.totalChars -= (removed.length + 1);
        this.startLineIndex += 1;
      }
    }
  }
}
