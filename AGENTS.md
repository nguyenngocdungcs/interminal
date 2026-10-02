# AGENTS.md - Interminal Developer & Agent Guide

> **Context & guidelines for AI agents working on this codebase.**

---

## 1. Project Overview

**Interminal** is a persistent interactive terminal companion plugin for AI agents (Model Context Protocol / MCP clients like Claude Desktop, Hermes Agent).

### Core Concepts
- **Persistent PTY Session:** Uses `node-pty` to keep shell state (working directory, environment variables, background processes) alive across tool calls.
- **Observer-Based Model:** AI agents send input via `write_to_terminal` and inspect output via `read_terminal` with cursor-based pagination and ANSI/spinner sanitization.
- **Live Web Companion:** Streams raw terminal character I/O over WebSocket to a browser UI (running on `http://localhost:3010`), allowing humans to observe and take over input in real time.

---

## 2. Invariants & Key Gotchas

### A. Standalone Companion & MCP Server
- Interminal runs as a standalone server exposing Web UI (`/`), WebSocket stream (`/ws`), and MCP endpoints (`/sse`, `/mcp`).
- AI agents connect via SSE/HTTP transport (`http://localhost:3010/sse`). Multiple clients can connect concurrently.

### B. Observer & Multi-Tab Model
- All tools follow `noun_verb` naming: `tab_list`, `tab_create`, `tab_close`, `tab_rename`, `terminal_write`, `terminal_read`.
- `terminal_write`: Dispatches input to the specific tab specified by required `tabId: number` (auto-appends `\n` by default).
- `terminal_read`: Returns paginated plain-text output with cursor tracking from the specific tab specified by required `tabId: number`.
- `tab_list`, `tab_create`, `tab_close`, `tab_rename`: For inspecting, creating, closing, and renaming standalone terminal sessions keyed by 0-indexed integer IDs (`0`, `1`, `2`...).


### C. Persistent Shell Handling
- Preserves shell state (environment variables, working directory, background processes) across tool calls.

---

## 3. Essential Commands

- `npm test` — Run the automated test suite.
- `npm run build` — Build frontend and backend bundles for production.
- `npm run dev` — Run development mode with hot reload.
- `npm start` — Run production companion server.
