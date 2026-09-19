import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PtyManager } from '../pty/pty-manager.js';

export class TerminalMcpServer {
  public readonly server: McpServer;
  private ptyManager: PtyManager;

  constructor(ptyManager: PtyManager) {
    this.ptyManager = ptyManager;
    this.server = new McpServer({
      name: 'interminal',
      version: '0.1.0',
    });
    this.registerTools();
  }

  private registerTools(): void {
    this.server.tool(
      'execute_command',
      'Execute a command in the persistent terminal and block until it exits or reaches its safety timeout.',
      {
        command: z.string().describe('The shell command to execute.'),
        timeout_ms: z.number().positive().optional().describe('Safety timeout in milliseconds (default: 60000).'),
      },
      async ({ command, timeout_ms }) => {
        try {
          const started = this.ptyManager.startCommand(command, timeout_ms ?? 60000);
          const result = await this.ptyManager.waitForCommand(started.commandId);
          const payload = {
            ...result,
            success: result.status === 'exited' && result.exitCode === 0,
          };
          return this.jsonResponse(payload, result.status !== 'exited');
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'start_command',
      'Start a foreground command without blocking. Use its commandId to poll, send input, or cancel.',
      {
        command: z.string().describe('The shell command to execute.'),
        timeout_ms: z.number().positive().optional().describe('Safety timeout in milliseconds (default: 60000).'),
      },
      async ({ command, timeout_ms }) => {
        try {
          return this.jsonResponse(this.ptyManager.startCommand(command, timeout_ms ?? 60000));
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'poll_command',
      'Read command output from an absolute character offset and inspect its lifecycle state.',
      {
        command_id: z.string().describe('Command ID returned by start_command.'),
        offset: z.number().int().nonnegative().optional().describe('Absolute output offset (default: 0).'),
      },
      async ({ command_id, offset }) => {
        try {
          return this.jsonResponse(this.ptyManager.pollCommand(command_id, offset ?? 0));
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'send_input',
      'Send input only to the running foreground command identified by command_id. Automatically appends a trailing newline if not present.',
      {
        command_id: z.string().describe('Command ID returned by start_command.'),
        input: z.string().describe('Input string or control characters to send.'),
      },
      async ({ command_id, input }) => {
        try {
          return this.jsonResponse(this.ptyManager.sendInput(command_id, input));
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'cancel_command',
      'Cancel the running foreground command identified by command_id using Ctrl+C.',
      {
        command_id: z.string().describe('Command ID returned by start_command.'),
      },
      async ({ command_id }) => {
        try {
          return this.jsonResponse(await this.ptyManager.cancelCommand(command_id));
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'start_session',
      'Start a new local shell or remote SSH terminal session.',
      {
        session_type: z.enum(['local', 'ssh']).describe('Session type ("local" or "ssh").'),
        target: z.string().optional().describe('SSH target and optional arguments. Required for ssh sessions.'),
      },
      async ({ session_type, target }) => {
        try {
          if (session_type === 'ssh' && !target) {
            throw new Error('target is required for an SSH session.');
          }
          return this.jsonResponse(this.ptyManager.spawnSession(session_type, target));
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'get_session_status',
      'Retrieve terminal session type, process PID, busy state, and dimensions.',
      {},
      async () => this.jsonResponse(this.ptyManager.getStatus()),
    );
  }

  private jsonResponse(payload: unknown, isError = false) {
    return {
      ...(isError ? { isError: true } : {}),
      content: [{ type: 'text' as const, text: JSON.stringify(payload, null, 2) }],
    };
  }

  private errorResponse(error: unknown) {
    return this.jsonResponse({
      error: error instanceof Error ? error.message : String(error),
    }, true);
  }

  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
