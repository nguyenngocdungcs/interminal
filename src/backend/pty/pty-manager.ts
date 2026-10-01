import * as pty from 'node-pty';
import { EventEmitter } from 'events';
import {
  TerminalHistory,
  type ReadTerminalOptions,
  type ReadTerminalResult,
  stripAnsi,
} from './terminal-history.js';

export {
  TerminalHistory,
  type ReadTerminalOptions,
  type ReadTerminalResult,
  stripAnsi,
};

export interface SessionStatus {
  pid: number;
  cols: number;
  rows: number;
}

export class PtyManager extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private cols = 80;
  private rows = 24;
  private history: TerminalHistory;

  constructor(history?: TerminalHistory) {
    super();
    this.history = history ?? new TerminalHistory();
  }

  public getHistory(): TerminalHistory {
    return this.history;
  }

  public spawnSession(): SessionStatus {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch {
        // Ignore cleanup errors while replacing a session.
      }
      this.ptyProcess = null;
    }

    this.history.reset();

    const shell = process.platform === 'win32'
      ? 'powershell.exe'
      : (process.env.SHELL || '/bin/zsh');
    const env = {
      ...process.env,
      TERM: 'xterm-256color',
      COLORTERM: 'truecolor',
    };

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
      this.spawnSession();
    }
    const formatted = autoEnter && !/[\r\n]$/.test(input) ? `${input}\n` : input;
    this.write(formatted);
  }

  public readTerminal(options: ReadTerminalOptions = {}): ReadTerminalResult {
    return this.history.read(options);
  }

  public appendRawData(data: string): void {
    this.history.append(data);
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
      pid: this.ptyProcess?.pid ?? -1,
      cols: this.cols,
      rows: this.rows,
    };
  }

  public destroy(): void {
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch {
        // Ignore errors during cleanup
      }
      this.ptyProcess = null;
    }
  }
}
