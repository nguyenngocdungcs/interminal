# AGENTS.md - Interminal Developer & Agent Guide

> **Context Document for AI Agents working on this codebase.**

---

## 1. Project Overview & Purpose

**Interminal** is a persistent interactive terminal companion plugin for AI agents (Claude Desktop, Hermes Agent, and any Model Context Protocol / MCP client).

Unlike standard stateless agent tools (which execute isolated `exec("cmd")` calls), Interminal:
1. Maintains a **persistent master PTY session** (`node-pty`) where directories (`cd`), environment variables (`export`), and background jobs remain alive across tool calls.
2. Streams raw character output in real time over **WebSocket** to a browser UI (`xterm.js` on `http://localhost:3010`), allowing humans to observe live execution and take over the keyboard manually (<kbd>↑</kbd> Up Arrow, <kbd>Tab</kbd>, `Ctrl+C`).
3. Uses an **Observer-Based Terminal Architecture**:
   - AI agents write keystrokes/commands using `write_to_terminal` (with automatic `\n` appending via `auto_enter`).
   - AI agents poll clean, sanitized plain-text output using `read_terminal` with cursor-based pagination (capped at 500 lines per call) and `has_more` indicators.
   - Preserves rolling memory buffers (up to 5,000 lines / 1MB) with ANSI codes and progress bar `\r` overwrites sanitized for token efficiency.

---

## 2. Tech Stack & Key Libraries

- **Runtime & Language:** Node.js (v18+), TypeScript, ESM (`"type": "module"`).
- **AI Agent Protocol:** `@modelcontextprotocol/sdk` (StdioServerTransport).
- **Terminal Backend:** `node-pty` (Persistent pseudo-terminal for local `/bin/zsh` or native `ssh user@host`).
- **Web & Streaming Server:** `fastify` + `@fastify/websocket` + `@fastify/static` (strictly listens on port `3010`).
- **Frontend:** React 18, Vite, Tailwind CSS, `@xterm/xterm`, `@xterm/addon-fit`, `@xterm/addon-web-links`, `lucide-react`.
- **Build Tooling:** `vite build` (frontend -> `dist/client`), `tsup` (backend -> `dist/backend`).

---

## 3. Directory Map

```text
interminal/
├── src/
│   ├── backend/
│   │   ├── index.ts                # Main entry point (starts MCP Stdio immediately, launches WebServer in background)
│   │   ├── mcp/
│   │   │   └── server.ts           # MCP Server registration & tool definitions
│   │   ├── pty/
│   │   │   └── pty-manager.ts      # node-pty wrapper, rolling buffer, and ANSI sanitization
│   │   └── server/
│   │       └── web-server.ts       # Fastify HTTP server, WebSocket relay (/ws), static client serving
│   │
│   └── frontend/
│       ├── index.html              # HTML entry
│       ├── src/
│       │   ├── main.tsx            # React mount
│       │   ├── App.tsx             # Main layout, status indicators, badges
│       │   ├── components/
│       │   │   └── TerminalView.tsx# xterm.js instance, WebSocket stream connector, resize listeners
│       │   └── styles/
│       │       └── globals.css     # Tailwind + xterm styles
│
├── dist/                           # Compiled production assets
│   ├── backend/index.js            # Node backend bundle
│   └── client/                     # Static frontend SPA bundle
│
├── tests/
│   ├── pty.test.mjs                # PTY persistence, sequential cd, exit codes tests
│   ├── terminal-observer.test.mjs  # Pagination, 500-line cap, has_more, ANSI stripping, rolling buffer
│   ├── mcp-tools.test.mjs          # MCP write_to_terminal & read_terminal tool integration tests
│   └── integration.test.mjs        # End-to-end WebSocket streaming & input injection test
│
├── system_design.md                # System architecture documentation
├── README.md                       # User-facing guide & Hermes/Claude setup
└── package.json
```

---

## 4. Key Architectural Patterns & Gotchas

### A. Zero-Latency MCP Handshake
- In `src/backend/index.ts`, `mcpServer.start()` **MUST connect to StdioServerTransport immediately and synchronously** on process launch.
- If MCP connection is delayed behind asynchronous web server startup, MCP clients (Hermes/Claude) may time out and repeatedly restart the server.

### B. Observer Terminal Model
- Keystrokes, commands, and control codes are dispatched through `write_to_terminal({ input: string, auto_enter?: boolean })`.
  - Default `auto_enter: true` ensures commands run with trailing `\n`.
  - Pass `auto_enter: false` for single keystrokes (`q`) or control sequences (`\x03` for Ctrl+C).
- Agents read terminal state using `read_terminal({ cursor?: number, limit?: number })`.
  - Returns clean, plain-text lines with ANSI codes stripped and carriage return (`\r`) spinner/progress bar overwrites normalized.
  - Returns `cursor` (index of the last line in the batch) for subsequent reads so that the active shell prompt and any typed commands on that line are seamlessly captured without skipping.

### C. Unified Local vs. Remote Shell
- Local session: `pty.spawn(process.env.SHELL || '/bin/zsh', [], options)`.
- Remote SSH session: `pty.spawn('ssh', [target], options)`.
- Both use the identical PTY streaming and observer lifecycle logic.

---

## 5. Development & Testing Commands

- **Build everything:** `npm run build` (builds both frontend and backend).
- **Run automated test suite:** `npm test` (executes PTY, terminal observer, MCP tool, and WebSocket integration tests).
- **Run in dev mode:** `npm run dev` (runs backend with `tsx watch` + Vite on `http://localhost:5173`).
- **Run production companion:** `npm start` (opens `http://localhost:3010`).
