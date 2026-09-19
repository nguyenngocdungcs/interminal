# AGENTS.md - Interminal Developer & Agent Guide

> **Context Document for AI Agents working on this codebase.**

---

## 1. Project Overview & Purpose

**Interminal** is a persistent interactive terminal companion plugin for AI agents (Claude Desktop, Hermes Agent, and any Model Context Protocol / MCP client).

Unlike standard stateless agent tools (which execute isolated `exec("cmd")` calls), Interminal:
1. Maintains a **persistent master PTY session** (`node-pty`) where directories (`cd`), environment variables (`export`), and background jobs remain alive across tool calls.
2. Streams raw character output in real time over **WebSocket** to a browser UI (`xterm.js` on `http://localhost:3010`), allowing humans to observe live execution and take over the keyboard manually (<kbd>↑</kbd> Up Arrow, <kbd>Tab</kbd>, `Ctrl+C`).
3. Exposes standard **MCP Tools** over `stdio` (`execute_command`, `start_command`, `poll_command`, command-scoped `send_input`, `cancel_command`, `start_session`, `get_session_status`).

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
│   │   │   └── pty-manager.ts      # node-pty wrapper and terminal session lifecycle
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
│   ├── command-lifecycle.test.mjs  # Delayed output, markers, polling, input, timeout/cancel tests
│   ├── mcp-tools.test.mjs          # MCP blocking and interactive tool integration tests
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

### B. Explicit Command Lifecycle and Interactive Ownership
- Never infer command completion from output silence. Each command is wrapped with a unique private marker carrying its real exit code.
- Use `execute_command` for blocking commands. Use `start_command` → `poll_command` → command-scoped `send_input` for interactive commands.
- Only one foreground command owns a PTY at a time. Input must include its `command_id`.
- Cancellation first sends `Ctrl+C`; if the process ignores it, Interminal kills the owning PTY before releasing command ownership. The next command starts a fresh shell.

### C. Unified Local vs. Remote Shell
- Local session: `pty.spawn(process.env.SHELL || '/bin/zsh', [], options)`.
- Remote SSH session: `pty.spawn('ssh', [target], options)`.
- Both use the identical PTY streaming and lifecycle management logic and require a POSIX-compatible shell for command markers.

---

## 5. Development & Testing Commands

- **Build everything:** `npm run build` (builds both frontend and backend).
- **Run automated test suite:** `npm test` (executes PTY, command lifecycle, MCP tool, and WebSocket integration tests).
- **Run in dev mode:** `npm run dev` (runs backend with `tsx watch` + Vite on `http://localhost:5173`).
- **Run production companion:** `npm start` (opens `http://localhost:3010`).
