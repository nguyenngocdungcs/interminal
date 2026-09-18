import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { PtyManager } from '../pty/pty-manager.js';

export class TerminalMcpServer {
  private server: McpServer;
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
    // 1. Tool: execute_command
    this.server.tool(
      'execute_command',
      'Execute a command in the persistent terminal session, streaming its output in real-time to the web viewer and awaiting final exit code and response.',
      {
        command: z.string().describe('The shell command to execute.'),
        timeout_ms: z.number().optional().describe('Timeout in milliseconds (default: 60000).'),
      },
      async ({ command, timeout_ms }) => {
        try {
          const result = await this.ptyManager.executeCommand(command, timeout_ms || 60000);
          return {
            content: [
              {
                type: 'text',
                text: JSON.stringify({
                  output: result.output,
                  exitCode: result.exitCode,
                  success: result.exitCode === 0,
                }, null, 2),
              },
            ],
          };
        } catch (error: any) {
          return {
            isError: true,
            content: [
              {
                type: 'text',
                text: `Execution Error: ${error?.message || String(error)}`,
              },
            ],
          };
        }
      }
    );

    // 2. Tool: send_input
    this.server.tool(
      'send_input',
      'Send raw input characters (e.g. answering prompts with "y\\n", or sending Ctrl+C via "\\x03") directly to the active terminal.',
      {
        input: z.string().describe('Raw input string or control character sequence.'),
      },
      async ({ input }) => {
        this.ptyManager.write(input);
        return {
          content: [
            {
              type: 'text',
              text: `Successfully sent ${JSON.stringify(input)} to the terminal.`,
            },
          ],
        };
      }
    );

    // 3. Tool: start_session
    this.server.tool(
      'start_session',
      'Start a new terminal session. Either local shell or remote SSH session.',
      {
        session_type: z.enum(['local', 'ssh']).describe('Session type ("local" or "ssh").'),
        target: z.string().optional().describe('SSH connection target (e.g., "user@hostname" or "-p 2222 user@host"). Only for ssh type.'),
      },
      async ({ session_type, target }) => {
        const status = this.ptyManager.spawnSession(session_type, target);
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      }
    );

    // 4. Tool: get_session_status
    this.server.tool(
      'get_session_status',
      'Retrieve current terminal session status, type, process PID, and dimensions.',
      {},
      async () => {
        const status = this.ptyManager.getStatus();
        return {
          content: [
            {
              type: 'text',
              text: JSON.stringify(status, null, 2),
            },
          ],
        };
      }
    );
  }

  public async start(): Promise<void> {
    const transport = new StdioServerTransport();
    await this.server.connect(transport);
  }
}
