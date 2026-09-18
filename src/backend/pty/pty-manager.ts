import * as pty from 'node-pty';
import { EventEmitter } from 'events';

export type SessionType = 'local' | 'ssh';

export interface SessionStatus {
  sessionType: SessionType;
  target?: string;
  pid: number;
  isBusy: boolean;
  cols: number;
  rows: number;
}

export interface CommandResult {
  output: string;
  exitCode: number;
}

export class PtyManager extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private sessionType: SessionType = 'local';
  private target?: string;
  private isBusy: boolean = false;
  private cols: number = 80;
  private rows: number = 24;

  // Active command execution listener
  private activeCommand: {
    command: string;
    buffer: string;
    resolve: (result: CommandResult) => void;
    reject: (error: Error) => void;
    timer: NodeJS.Timeout;
    idleTimer?: NodeJS.Timeout;
  } | null = null;

  constructor() {
    super();
  }

  public spawnSession(type: SessionType = 'local', target?: string): SessionStatus {
    // Clean up existing session if any
    if (this.ptyProcess) {
      try {
        this.ptyProcess.kill();
      } catch (e) {
        // Ignore cleanup errors
      }
      this.ptyProcess = null;
    }

    this.sessionType = type;
    this.target = target;

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
        // Fallback if process.cwd() is unavailable
      }

      this.ptyProcess = pty.spawn(shell, [], {
        name: 'xterm-256color',
        cols: this.cols,
        rows: this.rows,
        cwd: workingDir,
        env,
      });
    }

    this.ptyProcess.onData((data: string) => {
      // Emit raw stream event for WebSocket broadcast
      this.emit('data', data);

      // Handle active MCP command execution buffer
      if (this.activeCommand) {
        this.activeCommand.buffer += data;

        // Reset idle debounce timer on every new chunk of data
        if (this.activeCommand.idleTimer) {
          clearTimeout(this.activeCommand.idleTimer);
        }

        // Wait for 300ms of stream silence to assume command has produced its output
        this.activeCommand.idleTimer = setTimeout(() => {
          if (this.activeCommand) {
            clearTimeout(this.activeCommand.timer);

            const ansiRegex = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
            let cleanOutput = this.activeCommand.buffer
              .replace(ansiRegex, '')
              .replace(/\r\n/g, '\n')
              .trim();

            const resolve = this.activeCommand.resolve;
            this.activeCommand = null;
            this.isBusy = false;
            resolve({ output: cleanOutput, exitCode: 0 });
          }
        }, 300);
      }
    });

    this.ptyProcess.onExit(({ exitCode, signal }) => {
      this.emit('exit', { exitCode, signal });
      if (this.activeCommand) {
        clearTimeout(this.activeCommand.timer);
        if (this.activeCommand.idleTimer) {
          clearTimeout(this.activeCommand.idleTimer);
        }
        this.activeCommand.resolve({
          output: this.activeCommand.buffer,
          exitCode: exitCode ?? -1,
        });
        this.activeCommand = null;
      }
      this.ptyProcess = null;
      this.isBusy = false;
    });

    return this.getStatus();
  }

  public write(data: string): void {
    if (this.ptyProcess) {
      this.ptyProcess.write(data);
    }
  }

  public resize(cols: number, rows: number): void {
    this.cols = Math.max(10, cols);
    this.rows = Math.max(5, rows);
    if (this.ptyProcess) {
      try {
        this.ptyProcess.resize(this.cols, this.rows);
      } catch (e) {
        // ignore resize if pty is transitioning
      }
    }
  }

  public async executeCommand(command: string, timeoutMs: number = 60000): Promise<CommandResult> {
    if (!this.ptyProcess) {
      this.spawnSession(this.sessionType, this.target);
    }

    if (this.activeCommand) {
      throw new Error('Another command is currently executing.');
    }

    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        if (this.activeCommand) {
          this.write('\x03');
          const timeoutBuffer = this.activeCommand.buffer;
          this.activeCommand = null;
          this.isBusy = false;
          reject(new Error(`Command timed out after ${timeoutMs}ms. Output before timeout: ${timeoutBuffer}`));
        }
      }, timeoutMs);

      this.isBusy = true;
      this.activeCommand = {
        command,
        buffer: '',
        resolve,
        reject,
        timer,
      };

      // Direct write with no echo sentinel wrapper
      this.write(`${command}\n`);
    });
  }

  public getStatus(): SessionStatus {
    return {
      sessionType: this.sessionType,
      target: this.target,
      pid: this.ptyProcess?.pid ?? -1,
      isBusy: this.isBusy,
      cols: this.cols,
      rows: this.rows,
    };
  }
}
