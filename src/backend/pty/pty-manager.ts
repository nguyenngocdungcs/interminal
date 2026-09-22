import * as pty from 'node-pty';
import { randomBytes, randomUUID } from 'crypto';
import { EventEmitter } from 'events';

export type SessionType = 'local' | 'ssh';
export type CommandStatus = 'running' | 'exited' | 'timed_out' | 'cancelled';

export interface SessionStatus {
  sessionType: SessionType;
  target?: string;
  pid: number;
  isBusy: boolean;
  cols: number;
  rows: number;
}

export interface CommandSnapshot {
  commandId: string;
  command: string;
  status: CommandStatus;
  output: string;
  nextOffset: number;
  exitCode: number | null;
}

export type CommandResult = CommandSnapshot;

interface CommandRecord {
  commandId: string;
  command: string;
  nonce: string;
  startMarker: string;
  endPrefix: string;
  phase: 'awaiting_start' | 'capturing';
  parserBuffer: string;
  output: string;
  status: CommandStatus;
  exitCode: number | null;
  timer: NodeJS.Timeout;
  interruptTimer?: NodeJS.Timeout;
  resolve: (result: CommandResult) => void;
  completion: Promise<CommandResult>;
  webUiBuffer?: string;
  webUiStarted?: boolean;
}

const COMPLETED_HISTORY_LIMIT = 20;
const CANCEL_GRACE_MS = 1000;
const ANSI_REGEX = /\x1B(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;

export class PtyManager extends EventEmitter {
  private ptyProcess: pty.IPty | null = null;
  private sessionType: SessionType = 'local';
  private target?: string;
  private isBusy = false;
  private cols = 80;
  private rows = 24;
  private activeCommand: CommandRecord | null = null;
  private commands = new Map<string, CommandRecord>();

  public spawnSession(type: SessionType = 'local', target?: string): SessionStatus {
    if (this.activeCommand) {
      this.finishCommand(this.activeCommand, 'cancelled', null);
    }
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
      console.log('[node-pty output]:', JSON.stringify(data));
      this.emitWebUiData(data);
      if (this.activeCommand) {
        this.consumeCommandData(this.activeCommand, data);
      }
    });

    sessionPty.onExit(({ exitCode, signal }) => {
      if (this.ptyProcess !== sessionPty) {
        return;
      }
      this.emit('exit', { exitCode, signal });
      if (this.activeCommand) {
        const record = this.activeCommand;
        this.appendOutput(record, record.parserBuffer);
        record.parserBuffer = '';
        this.finishCommand(
          record,
          record.status === 'running' ? 'exited' : record.status,
          record.status === 'running' ? (exitCode ?? -1) : null,
        );
      }
      this.ptyProcess = null;
      this.isBusy = false;
    });

    return this.getStatus();
  }

  public write(data: string): void {
    this.ptyProcess?.write(data);
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

  public startCommand(command: string, timeoutMs: number = 60000): CommandSnapshot {
    if (process.platform === 'win32') {
      throw new Error('Command lifecycle markers currently require a POSIX-compatible shell.');
    }
    if (!this.ptyProcess) {
      this.spawnSession(this.sessionType, this.target);
    }
    if (this.activeCommand) {
      throw new Error('Another command is currently executing.');
    }
    if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
      throw new Error('timeoutMs must be a positive number.');
    }

    const commandId = randomUUID();
    const nonce = randomBytes(24).toString('hex');
    const startMarker = `\x1b]777;interminal;${nonce};start\x07`;
    const endPrefix = `\x1b]777;interminal;${nonce};end;`;
    let resolve!: (result: CommandResult) => void;
    const completion = new Promise<CommandResult>((done) => {
      resolve = done;
    });
    const record: CommandRecord = {
      commandId,
      command,
      nonce,
      startMarker,
      endPrefix,
      phase: 'awaiting_start',
      parserBuffer: '',
      output: '',
      status: 'running',
      exitCode: null,
      timer: setTimeout(() => {
        if (record.status === 'running') {
          record.status = 'timed_out';
          record.exitCode = null;
          this.write('\x03');
          record.interruptTimer = setTimeout(() => {
            this.forceStopSession(record);
          }, CANCEL_GRACE_MS);
        }
      }, timeoutMs),
      resolve,
      completion,
    };

    this.activeCommand = record;
    this.commands.set(commandId, record);
    this.isBusy = true;
    this.trimHistory();
    this.write(this.wrapCommand(command, record));
    return this.snapshot(record);
  }

  public pollCommand(commandId: string, offset: number = 0): CommandSnapshot {
    const record = this.getCommand(commandId);
    if (!Number.isInteger(offset) || offset < 0) {
      throw new Error('offset must be a non-negative integer.');
    }
    return this.snapshot(record, offset);
  }

  public sendInput(commandId: string, input: string): CommandSnapshot {
    const record = this.getCommand(commandId);
    if (record !== this.activeCommand || record.status !== 'running') {
      throw new Error(`Command ${commandId} is not running and cannot receive input.`);
    }
    const formattedInput = input.endsWith('\n') || input.endsWith('\r') ? input : `${input}\n`;
    this.write(formattedInput);
    return this.snapshot(record);
  }

  public async cancelCommand(commandId: string): Promise<CommandSnapshot> {
    const record = this.getCommand(commandId);
    if (record !== this.activeCommand || record.status !== 'running') {
      throw new Error(`Command ${commandId} is not running and cannot be cancelled.`);
    }
    record.status = 'cancelled';
    record.exitCode = null;
    clearTimeout(record.timer);
    this.write('\x03');
    record.interruptTimer = setTimeout(() => {
      this.forceStopSession(record);
    }, CANCEL_GRACE_MS);
    return record.completion;
  }

  public waitForCommand(commandId: string): Promise<CommandResult> {
    return this.getCommand(commandId).completion;
  }

  public async executeCommand(command: string, timeoutMs: number = 60000): Promise<CommandResult> {
    const started = this.startCommand(command, timeoutMs);
    return this.waitForCommand(started.commandId);
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

  private wrapCommand(command: string, record: CommandRecord): string {
    const encoded = Buffer.from(command, 'utf8').toString('base64');
    const start = `\\033]777;interminal;${record.nonce};start\\007`;
    const end = `\\033]777;interminal;${record.nonce};end;%s\\007`;
    return `printf '${start}'; eval "$(printf '%s' '${encoded}' | base64 -d)"; __interminal_ec=$?; printf '${end}' "$__interminal_ec"\n`;
  }

  private consumeCommandData(record: CommandRecord, data: string): void {
    record.parserBuffer += data;

    if (record.phase === 'awaiting_start') {
      const markerIndex = record.parserBuffer.indexOf(record.startMarker);
      if (markerIndex < 0) {
        record.parserBuffer = this.possibleMarkerSuffix(record.parserBuffer, record.startMarker);
        return;
      }
      record.parserBuffer = record.parserBuffer.slice(markerIndex + record.startMarker.length);
      record.phase = 'capturing';
    }

    const endIndex = record.parserBuffer.indexOf(record.endPrefix);
    if (endIndex < 0) {
      const suffix = this.possibleMarkerSuffix(record.parserBuffer, record.endPrefix);
      this.appendOutput(record, record.parserBuffer.slice(0, record.parserBuffer.length - suffix.length));
      record.parserBuffer = suffix;
      return;
    }

    this.appendOutput(record, record.parserBuffer.slice(0, endIndex));
    const markerEnd = record.parserBuffer.indexOf('\x07', endIndex + record.endPrefix.length);
    if (markerEnd < 0) {
      record.parserBuffer = record.parserBuffer.slice(endIndex);
      return;
    }

    const exitText = record.parserBuffer.slice(endIndex + record.endPrefix.length, markerEnd);
    if (!/^-?\d+$/.test(exitText)) {
      // A nonce match with a malformed payload is ordinary command output.
      this.appendOutput(record, record.parserBuffer.slice(0, markerEnd + 1));
      record.parserBuffer = record.parserBuffer.slice(markerEnd + 1);
      return;
    }

    record.parserBuffer = record.parserBuffer.slice(markerEnd + 1);
    if (record.status === 'running') {
      this.finishCommand(record, 'exited', Number(exitText));
    } else {
      this.finishCommand(record, record.status, null);
    }
  }

  private possibleMarkerSuffix(value: string, marker: string): string {
    const limit = Math.min(value.length, marker.length - 1);
    for (let length = limit; length > 0; length -= 1) {
      if (value.endsWith(marker.slice(0, length))) {
        return value.slice(-length);
      }
    }
    return '';
  }

  private appendOutput(record: CommandRecord, value: string): void {
    record.output += value.replace(ANSI_REGEX, '').replace(/\r\n/g, '\n').replace(/\r/g, '');
  }

  private forceStopSession(record: CommandRecord): void {
    if (this.activeCommand !== record || record.status === 'running') {
      return;
    }
    // A foreground process may ignore Ctrl+C. Kill the owning PTY so command
    // ownership is not released while that process can still consume input.
    // The next command lazily creates a fresh shell session.
    this.ptyProcess?.kill('SIGKILL');
  }

  private finishCommand(record: CommandRecord, status: CommandStatus, exitCode: number | null): void {
    clearTimeout(record.timer);
    if (record.interruptTimer) {
      clearTimeout(record.interruptTimer);
      record.interruptTimer = undefined;
    }
    if (record.webUiBuffer && !record.webUiStarted) {
      this.emit('data', record.webUiBuffer);
      record.webUiBuffer = '';
    }
    record.status = status;
    record.exitCode = exitCode;
    if (this.activeCommand === record) {
      this.activeCommand = null;
      this.isBusy = false;
    }
    record.resolve(this.snapshot(record));
    this.trimHistory();
  }

  private emitWebUiData(data: string): void {
    const record = this.activeCommand;
    if (!record || record.webUiStarted) {
      this.emit('data', data);
      return;
    }

    record.webUiBuffer = (record.webUiBuffer || '') + data;
    const markerIndex = record.webUiBuffer.indexOf(record.startMarker);
    if (markerIndex < 0) {
      return;
    }

    record.webUiStarted = true;
    const remaining = record.webUiBuffer.slice(markerIndex);
    record.webUiBuffer = '';
    const formattedCommand = record.command.replace(/\r?\n/g, '\r\n');
    this.emit('data', `${formattedCommand}\r\n${remaining}`);
  }

  private getCommand(commandId: string): CommandRecord {
    const record = this.commands.get(commandId);
    if (!record) {
      throw new Error(`Unknown or stale command ID: ${commandId}`);
    }
    return record;
  }

  private snapshot(record: CommandRecord, offset: number = 0): CommandSnapshot {
    const safeOffset = Math.min(offset, record.output.length);
    return {
      commandId: record.commandId,
      command: record.command,
      status: record.status,
      output: record.output.slice(safeOffset),
      nextOffset: record.output.length,
      exitCode: record.exitCode,
    };
  }

  private trimHistory(): void {
    const completed = [...this.commands.values()].filter((record) => record !== this.activeCommand && record.status !== 'running');
    while (completed.length > COMPLETED_HISTORY_LIMIT) {
      const oldest = completed.shift();
      if (oldest) {
        this.commands.delete(oldest.commandId);
      }
    }
  }
}
