import Fastify, { FastifyInstance } from 'fastify';
import fastifyWebsocket from '@fastify/websocket';
import fastifyStatic from '@fastify/static';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import { PtyManager } from '../pty/pty-manager.js';
import type { WebSocket } from 'ws';

export class WebServer {
  private app: FastifyInstance;
  private ptyManager: PtyManager;
  private port: number;
  private connectedSockets: Set<WebSocket> = new Set();

  constructor(ptyManager: PtyManager, port: number = 3010) {
    this.ptyManager = ptyManager;
    this.port = port;
    this.app = Fastify({
      logger: false, // Suppress fastify logs on stdout to avoid interfering with MCP stdio
    });
  }

  public async start(): Promise<string> {
    await this.app.register(fastifyWebsocket);

    // Setup WebSocket route for terminal I/O
    this.app.register(async (fastify) => {
      fastify.get('/ws', { websocket: true }, (socket, req) => {
        this.connectedSockets.add(socket);

        // Send initial status
        socket.send(JSON.stringify({
          type: 'status',
          status: this.ptyManager.getStatus(),
        }));

        // Handle incoming messages from browser
        socket.on('message', (rawMessage: any) => {
          try {
            const parsed = JSON.parse(rawMessage.toString());
            if (parsed.type === 'input' && typeof parsed.data === 'string') {
              this.ptyManager.write(parsed.data);
            } else if (parsed.type === 'resize' && parsed.cols && parsed.rows) {
              this.ptyManager.resize(parsed.cols, parsed.rows);
            } else if (parsed.type === 'spawn') {
              const status = this.ptyManager.spawnSession(parsed.sessionType, parsed.target);
              this.broadcast(JSON.stringify({ type: 'status', status }));
            }
          } catch (e) {
            // If message is raw string/keystroke instead of JSON
            this.ptyManager.write(rawMessage.toString());
          }
        });

        socket.on('close', () => {
          this.connectedSockets.delete(socket);
        });

        socket.on('error', () => {
          this.connectedSockets.delete(socket);
        });
      });
    });

    // Relay PTY data to all active WebSocket clients
    this.ptyManager.on('data', (data: string) => {
      this.broadcast(JSON.stringify({ type: 'output', data }));
    });

    this.ptyManager.on('exit', ({ exitCode, signal }) => {
      this.broadcast(JSON.stringify({
        type: 'exit',
        exitCode,
        signal,
        status: this.ptyManager.getStatus(),
      }));
    });

    // Serve frontend static assets if built
    const __filename = fileURLToPath(import.meta.url);
    const __dirname = path.dirname(__filename);
    
    let currentCwd = '';
    try {
      currentCwd = process.cwd();
    } catch {
      // ignore
    }

    const possiblePaths = [
      path.resolve(__dirname, '../client'),
      path.resolve(__dirname, '../../dist/client'),
      ...(currentCwd ? [path.resolve(currentCwd, 'dist/client')] : []),
    ];
    const clientDist = possiblePaths.find((p) => fs.existsSync(path.join(p, 'index.html')));

    if (clientDist) {
      await this.app.register(fastifyStatic, {
        root: clientDist,
        prefix: '/',
        wildcard: false,
      });

      this.app.get('/*', async (request, reply) => {
        return reply.sendFile('index.html');
      });
    } else {
      // Fallback dev route
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

    const address = await this.app.listen({ port: this.port, host: '0.0.0.0' });
    return address;
  }

  public broadcast(message: string): void {
    for (const socket of this.connectedSockets) {
      if (socket.readyState === 1) { // OPEN
        socket.send(message);
      }
    }
  }

  public async stop(): Promise<void> {
    for (const socket of this.connectedSockets) {
      socket.close();
    }
    this.connectedSockets.clear();
    await this.app.close();
  }
}
