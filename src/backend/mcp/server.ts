import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { z } from 'zod';
import { TabManager } from '../pty/tab-manager.js';

export class TerminalMcpServer {
  public readonly server: McpServer;
  private tabManager: TabManager;

  constructor(tabManager: TabManager) {
    this.tabManager = tabManager;
    this.server = new McpServer({
      name: 'interminal',
      version: '0.1.0',
    });
    this.registerTools();
  }

  private registerTools(): void {
    this.server.tool(
      'tab_list',
      'List all active terminal tabs.',
      {},
      async () => {
        try {
          return this.jsonResponse({
            tabs: this.tabManager.getTabs(),
          });
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'tab_create',
      'Create a new standalone terminal tab.',
      {
        title: z.string().optional().describe('Optional title for the new terminal tab.'),
      },
      async ({ title }) => {
        try {
          const session = this.tabManager.createTab(title);
          return this.jsonResponse({
            success: true,
            tab: {
              id: session.id,
              title: session.title,
            },
          });
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'tab_close',
      'Close a terminal tab by its numeric tabId.',
      {
        tabId: z.number().int().nonnegative().describe('0-indexed integer ID of the tab to close.'),
      },
      async ({ tabId }) => {
        try {
          const closed = this.tabManager.closeTab(tabId);
          if (!closed) {
            return this.errorResponse(new Error(`Tab not found: ${tabId}`));
          }
          return this.jsonResponse({
            success: true,
          });
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'tab_rename',
      'Rename an existing terminal tab.',
      {
        tabId: z.number().int().nonnegative().describe('0-indexed integer ID of the tab to rename.'),
        title: z.string().describe('New title for the terminal tab.'),
      },
      async ({ tabId, title }) => {
        try {
          const tab = this.tabManager.renameTab(tabId, title);
          return this.jsonResponse({
            success: true,
            tab,
          });
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'terminal_write',
      'Write commands, interactive input, or control characters (e.g. \\x03 for Ctrl+C) to a specific terminal tab.',
      {
        tabId: z.number().int().nonnegative().describe('0-indexed integer ID of target terminal tab.'),
        input: z.string().describe('The command string, keystrokes, or control characters to write to the tab.'),
        auto_enter: z.boolean().optional().default(true).describe('Automatically append newline (\\n) if not already present. Defaults to true. Set to false for single keystrokes or control sequences.'),
      },
      async ({ tabId, input, auto_enter }) => {
        try {
          const session = this.tabManager.getTab(tabId);
          if (!session) {
            return this.errorResponse(new Error(`Tab not found: ${tabId}`));
          }
          session.ptyManager.writeToTerminal(input, auto_enter);
          return this.jsonResponse({
            success: true,
          });
        } catch (error) {
          return this.errorResponse(error);
        }
      },
    );

    this.server.tool(
      'terminal_read',
      'Read sanitized plain-text output from a specific terminal tab using cursor-based pagination (up to 500 lines per call).',
      {
        tabId: z.number().int().nonnegative().describe('0-indexed integer ID of target terminal tab.'),
        cursor: z.number().int().nonnegative().optional().describe('0-indexed line cursor to read from.'),
        limit: z.number().int().positive().optional().describe('Maximum number of lines to return (capped at 500, default: 500).'),
      },
      async ({ tabId, cursor, limit }) => {
        try {
          const session = this.tabManager.getTab(tabId);
          if (!session) {
            return this.errorResponse(new Error(`Tab not found: ${tabId}`));
          }
          const result = session.ptyManager.readTerminal({ cursor, limit });
          return this.jsonResponse(result);
        } catch (error) {
          return this.errorResponse(error);
        }
      },
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

