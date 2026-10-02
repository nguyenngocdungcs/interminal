import Fastify, { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import fastifyWebsocket, { type WebSocket } from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { randomUUID } from 'node:crypto';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { TabManager, TabInfo } from '../pty/tab-manager.js';
import { TerminalMcpServer } from '../mcp/server.js';


export class WebServer {
  private app: FastifyInstance;
  private tabManager: TabManager;
  private port: number;
  private connectedSockets: Set<WebSocket> = new Set();
  private sseTransports: Map<string, SSEServerTransport> = new Map();
  private streamableTransports: Map<string, StreamableHTTPServerTransport> = new Map();

  constructor(tabManager: TabManager, port: number = 3010) {
    this.tabManager = tabManager;
    this.port = port;
    this.app = Fastify({ logger: false });
  }

  public async start(): Promise<string> {
    this.setupCors();
    this.setupMcpRoutes();
    await this.setupWebSocket();
    await this.setupStaticRoutes();

    return await this.app.listen({ port: this.port, host: '0.0.0.0' });
  }

  // --- CORS Configuration ---
  private setupCors(): void {
    this.app.addHook('onRequest', async (request: FastifyRequest, reply: FastifyReply) => {
      reply.header('Access-Control-Allow-Origin', '*');
      reply.header('Access-Control-Allow-Methods', 'GET, POST, DELETE, OPTIONS');
      reply.header('Access-Control-Allow-Headers', '*');
      reply.header('Access-Control-Expose-Headers', '*');
      if (request.method === 'OPTIONS') {
        return reply.status(204).send();
      }
    });
  }

  // --- MCP Protocol Endpoints (SSE & Streamable HTTP) ---
  private setupMcpRoutes(): void {
    // 1. Streamable HTTP endpoints (/mcp, /server/discover)
    this.app.all('/mcp', (req, rep) => this.handleStreamable(req, rep));
    this.app.all('/server/discover', (req, rep) => this.handleStreamable(req, rep));

    // 2. SSE Endpoints (/sse)
    this.app.get('/sse', async (req, rep) => {
      const accept = req.headers['accept'] || '';
      // Support clients negotiating Streamable HTTP over GET /sse
      if (accept.includes('application/json')) {
        return this.handleStreamable(req, rep);
      }
      return this.handleSseConnect(req, rep);
    });

    this.app.post('/sse', (req, rep) => this.handleSsePostFallback(req, rep));

    // 3. Message POST endpoint for SSE sessions
    this.app.post('/message', (req, rep) => this.handleSseMessage(req, rep));
  }

  private async handleStreamable(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    reply.hijack();
    const sessionId = (request.headers['mcp-session-id'] as string | undefined) ||
                      (request.query as { sessionId?: string })?.sessionId;

    if (sessionId) {
      const existing = this.streamableTransports.get(sessionId);
      if (existing) {
        await existing.handleRequest(request.raw, reply.raw, request.body);
        return;
      }
      reply.raw.writeHead(404, { 'Content-Type': 'application/json' }).end(
        JSON.stringify({ jsonrpc: '2.0', error: { code: -32001, message: 'Session not found' }, id: null })
      );
      return;
    }

    // Initialize new session for incoming client
    let sessionKey: string | undefined;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sId) => {
        sessionKey = sId;
        this.streamableTransports.set(sId, transport);
      },
      onsessionclosed: (sId) => {
        this.streamableTransports.delete(sId);
      },
      enableJsonResponse: true,
    });

    const mcpServer = new TerminalMcpServer(this.tabManager);
    await mcpServer.server.connect(transport);

    transport.onclose = () => {
      if (sessionKey) {
        this.streamableTransports.delete(sessionKey);
      }
    };

    await transport.handleRequest(request.raw, reply.raw, request.body);
  }

  private async handleSseConnect(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    reply.hijack();
    const transport = new SSEServerTransport('/message', reply.raw);
    const mcpServer = new TerminalMcpServer(this.tabManager);

    this.sseTransports.set(transport.sessionId, transport);
    transport.onclose = () => {
      this.sseTransports.delete(transport.sessionId);
    };

    await mcpServer.server.connect(transport);
  }

  private async handleSsePostFallback(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sessionId = (request.query as { sessionId?: string })?.sessionId;
    if (sessionId && this.sseTransports.has(sessionId)) {
      reply.hijack();
      await this.sseTransports.get(sessionId)!.handlePostMessage(request.raw, reply.raw, request.body);
      return;
    }
    await this.handleStreamable(request, reply);
  }

  private async handleSseMessage(request: FastifyRequest, reply: FastifyReply): Promise<void> {
    const sessionId = (request.query as { sessionId?: string })?.sessionId;
    if (!sessionId) {
      return reply.status(400).send({ error: 'Missing sessionId query parameter' });
    }

    const transport = this.sseTransports.get(sessionId);
    if (!transport) {
      return reply.status(404).send({ error: `Session not found: ${sessionId}` });
    }

    reply.hijack();
    await transport.handlePostMessage(request.raw, reply.raw, request.body);
  }

  // --- WebSocket Streaming ---
  private async setupWebSocket(): Promise<void> {
    await this.app.register(fastifyWebsocket);

    this.app.register(async (fastify) => {
      fastify.get('/ws', { websocket: true }, (socket, req) => {
        this.connectedSockets.add(socket);

        // Send current tab list upon connection
        socket.send(JSON.stringify({
          type: 'tab_list',
          tabs: this.tabManager.getTabs(),
        }));

        socket.on('message', (rawMessage: any) => {
          try {
            const parsed = JSON.parse(rawMessage.toString());
            const type = parsed.type;
            const tabId = typeof parsed.tabId === 'number' ? parsed.tabId : 0;

            if (type === 'terminal_input' && typeof parsed.data === 'string') {
              this.tabManager.getTab(tabId)?.ptyManager.write(parsed.data);
            } else if (type === 'terminal_resize' && parsed.cols && parsed.rows) {
              this.tabManager.getTab(tabId)?.ptyManager.resize(parsed.cols, parsed.rows);
            } else if (type === 'tab_create') {
              this.tabManager.createTab(parsed.title);
            } else if (type === 'tab_close' && typeof parsed.tabId === 'number') {
              this.tabManager.closeTab(parsed.tabId);
            } else if (type === 'tab_rename' && typeof parsed.tabId === 'number' && parsed.title) {
              this.tabManager.renameTab(parsed.tabId, parsed.title);
            } else if (type === 'tab_switch' && typeof parsed.tabId === 'number') {
              this.tabManager.setActiveTabId(parsed.tabId);
            }
          } catch {
            // Ignore malformed WS payloads
          }
        });

        socket.on('close', () => this.connectedSockets.delete(socket));
        socket.on('error', () => this.connectedSockets.delete(socket));
      });
    });

    this.tabManager.on('data', (tabId: number, data: string) => {
      this.broadcast(JSON.stringify({ type: 'terminal_output', tabId, data }));
    });

    this.tabManager.on('exit', (tabId: number, info: { exitCode: number; signal?: number }) => {
      this.broadcast(JSON.stringify({
        type: 'terminal_exit',
        tabId,
        exitCode: info.exitCode,
        signal: info.signal,
      }));
    });

    this.tabManager.on('tab_created', (tab: TabInfo) => {
      this.broadcast(JSON.stringify({ type: 'tab_created', tab }));
      this.broadcast(JSON.stringify({ type: 'tab_list', tabs: this.tabManager.getTabs() }));
    });

    this.tabManager.on('tab_closed', (tabId: number) => {
      this.broadcast(JSON.stringify({ type: 'tab_closed', tabId }));
      this.broadcast(JSON.stringify({ type: 'tab_list', tabs: this.tabManager.getTabs() }));
    });

    this.tabManager.on('tab_renamed', () => {
      this.broadcast(JSON.stringify({ type: 'tab_list', tabs: this.tabManager.getTabs() }));
    });
  }

  // --- Static Client Assets & Dev Fallback ---
  private async setupStaticRoutes(): Promise<void> {
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    let cwd = '';
    try { cwd = process.cwd(); } catch {}

    const searchPaths = [
      path.resolve(__dirname, '../client'),
      path.resolve(__dirname, '../../dist/client'),
      ...(cwd ? [path.resolve(cwd, 'dist/client')] : []),
    ];
    const clientDist = searchPaths.find((p) => fs.existsSync(path.join(p, 'index.html')));

    if (clientDist) {
      await this.app.register(fastifyStatic, {
        root: clientDist,
        prefix: '/',
        wildcard: false,
      });

      this.app.get('/*', async (request, reply) => reply.sendFile('index.html'));
    } else {
      this.app.get('/', async (request, reply) => {
        return reply.type('text/html').send(`
          <!DOCTYPE html>
          <html>
            <head><title>Interminal</title></head>
            <body style="background:#0f172a;color:#f8fafc;font-family:sans-serif;padding:2rem;">
              <h1>Interminal Web Bridge</h1>
              <p>WebSocket server is listening at <code>ws://localhost:${this.port}/ws</code>.</p>
              <p>Client build not found. Run <code>npm run build</code> to generate frontend bundle.</p>
            </body>
          </html>
        `);
      });
    }
  }

  public broadcast(message: string): void {
    for (const socket of this.connectedSockets) {
      if (socket.readyState === 1) {
        socket.send(message);
      }
    }
  }

  public async stop(): Promise<void> {
    for (const socket of this.connectedSockets) {
      socket.close();
    }
    this.connectedSockets.clear();

    for (const transport of this.sseTransports.values()) {
      try { await transport.close(); } catch {}
    }
    this.sseTransports.clear();

    for (const transport of this.streamableTransports.values()) {
      try { await transport.close(); } catch {}
    }
    this.streamableTransports.clear();

    await this.app.close();
  }
}

