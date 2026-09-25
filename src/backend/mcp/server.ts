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
      'write_to_terminal',
      'Write commands, interactive input, or control characters (e.g. \\x03 for Ctrl+C) to the terminal session.',
      {
        input: z.string().describe('The command string, keystrokes, or control characters to write to the terminal.'),
        auto_enter: z.boolean().optional().default(true).describe('Automatically append newline (\\n) if not already present. Defaults to true. Set to false for single keystrokes or control sequences.'),
      },
      async ({ input, auto_enter }) => {
        try {
          this.ptyManager.writeToTerminal(input, auto_enter);
          return this.jsonResponse({
            success: true,
          });
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'read_terminal',
      'Read sanitized plain-text output from the terminal session using cursor-based pagination (up to 500 lines per call).',
      {
        cursor: z.number().int().nonnegative().optional().describe('0-indexed line cursor to read from. Omit to read from start or oldest retained line.'),
        limit: z.number().int().positive().optional().describe('Maximum number of lines to return (capped at 500, default: 500).'),
      },
      async ({ cursor, limit }) => {
        try {
          const result = this.ptyManager.readTerminal({ cursor, limit });
          return this.jsonResponse(result);
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
      'Retrieve terminal session type, process PID, and dimensions.',
      {},
      async () => this.jsonResponse(this.ptyManager.getStatus()),
    );
  }

  private jsonResponse(payload: unknown, isError = false) {
    return {
      ...(isError ? { isError: true } : {}),
      content: [{ type: 'text' as const, text: JSON.stringify(payload) }],
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
