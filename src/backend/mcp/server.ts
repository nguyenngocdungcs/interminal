import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
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
      'Start or restart the interactive terminal session with a fresh shell and reset output buffer.',
      {},
      async () => {
        try {
          return this.jsonResponse(this.ptyManager.spawnSession());
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'get_session_status',
      'Retrieve terminal process PID and dimensions.',
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
}
