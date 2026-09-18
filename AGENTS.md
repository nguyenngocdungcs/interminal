# AGENTS.md - Interminal Developer & Agent Guide

> **Context Document for AI Agents working on this codebase.**

---

## 1. Project Overview & Purpose

**Interminal** is a persistent interactive terminal companion plugin for AI agents (Claude Desktop, Hermes Agent, and any Model Context Protocol / MCP client).

Unlike standard stateless agent tools (which execute isolated `exec("cmd")` calls), Interminal:
1. Maintains a **persistent master PTY session** (`node-pty`) where directories (`cd`), environment variables (`export`), and background jobs remain alive across tool calls.
2. Streams raw character output in real time over **WebSocket** to a browser UI (`xterm.js` on `http://localhost:3010`), allowing humans to observe live execution and take over the keyboard manually (<kbd>↑</kbd> Up Arrow, <kbd>Tab</kbd>, `Ctrl+C`).
3. Exposes standard **MCP Tools** over `stdio` (`execute_command`, `send_input`, `start_session`, `get_session_status`).

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
│   │   │   └── pty-manager.ts      # node-pty wrapper, sentinel exit detector, ANSI stripper
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

### B. OSC 133 Shell Integration & Command Lifecycle
- Interactive PTY shells never trigger OS process exit events on single command completion.
- Interminal uses standard **OSC 133 Semantic Prompt escape codes** injected via shell hooks (`preexec`/`precmd` in Zsh, `PROMPT_COMMAND` in Bash).
- Commands are written directly without modification (`pty.write("${command}\\n")`).
- The PTY stream parser detects `\x1b]133;C\x07` (command start) and `\x1b]133;D;<exit_code>\x07` (command finish with exit code), strips ANSI/OSC codes for the LLM response, and resolves the MCP tool promise.
- The web viewer continues to receive the raw ANSI stream with zero latency.

### C. Unified Local vs. Remote Shell
- Local session: `pty.spawn(process.env.SHELL || '/bin/zsh', [], options)`.
- Remote SSH session: `pty.spawn('ssh', [target], options)`.
- Both use the identical PTY streaming and lifecycle management logic.

---

## 5. Development & Testing Commands

- **Build everything:** `npm run build` (builds both frontend and backend).
- **Run automated test suite:** `npm test` (executes PTY unit tests + full WebSocket integration tests).
- **Run in dev mode:** `npm run dev` (runs backend with `tsx watch` + Vite on `http://localhost:5173`).
- **Run production companion:** `npm start` (opens `http://localhost:3010`).
