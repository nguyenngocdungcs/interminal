---
name: interminal
description: Guidelines for operating the Interminal interactive terminal companion, handling long-running tasks, reading terminal output efficiently with cursor, and managing interactive prompts and sensitive commands.
---

# Interminal Guidelines

### 🛠️ Quick Tools Overview
- **`tab_list`**: List all active terminal tabs with numeric `id` and `title`.
- **`tab_create`**: Create a new standalone terminal tab (optional `title`). Returns `{ tab: { id, title } }`.
- **`tab_close`**: Close a tab by its required numeric `tabId`.
- **`tab_rename`**: Rename a tab given its required numeric `tabId` and `title`.
- **`terminal_write`**: Send commands, interactive inputs, or control characters (e.g. `\x03` with `auto_enter: false` for `Ctrl+C`) to a specific `tabId` (required integer). Defaults to `auto_enter: true`.
- **`terminal_read`**: Read cleaned plain-text terminal output from a specific `tabId` (required integer). Always pass `cursor` from previous calls.

### 0. When to Use Interminal
- When the user says "use interminal", "do it using interminal", or signals that they want commands executed via the Interminal web terminal, **use Interminal MCP tools (`terminal_write`/`terminal_read`/`tab_create`) instead of the native Hermes `terminal` tool** for all command execution.
- The native `terminal` tool runs commands invisibly in a server-side shell. Interminal runs them in a visible PTY the user can watch and interact with. Prefer Interminal when the user wants to see output live or when commands need interactive input (SSH passwords, `sudo` prompts, menu selections).

### 1. Opening the Web Companion
- When the user asks to open Interminal, open `http://localhost:3010` using the agent environment's built-in browser (e.g., the **Preview pane** in Hermes).

### 2. Multi-Tab Session Management
- **Explicit `tabId`:** All `terminal_write` and `terminal_read` calls require `tabId` (0-indexed integer: `0`, `1`, `2`...).
- **Concurrent Tasks:** Use `tab_create` to spawn a dedicated tab for persistent dev servers or long-running jobs so main tab remains available.

### 3. Reading Output (Always Use Cursor)
- **Always provide `cursor`:** Always pass the `cursor` index returned by the previous `terminal_read` call (e.g., `{"tabId": 0, "cursor": 42}`).
- **Avoid context bloat:** Reading without a cursor returns the entire terminal buffer history for that tab, which wastes context window tokens.

### 4. SSH Workflow (Remote Commands)
- **Pattern**: `terminal_write(tabId, "ssh host command")` → wait 3-5s → `terminal_read(tabId, cursor=N)`.
- Commands must be self-contained (no interactive prompts): use `&&` chains, quoted strings, and avoid sudo or password-independent flags. Non-interactive SSH keys make this work; if the server asks for a password, stop and notify the user.
- **Batched output**: The SSH session returns all stdout at once. Read once with a generous wait; if the prompt isn't back yet, wait another 3s and re-read with the same cursor. Don't send more commands until the prompt confirms completion.
- **Commands needing interaction** (sudo, menu selections, input loops): use `terminal_write` with `auto_enter: false` and send each line separately, reading between writes.

### 5. Handling Long-Running Tasks
- **Wait before re-reading:** For commands that take time to execute, sleep for a few seconds before calling `terminal_read` again with the latest `cursor`.
- **Silent / Background tasks:** If no new output appears, do **not** write additional commands. Wait a few seconds and re-read.
- **Still no progress:** If there are still no signs of completion, stop, notify the user to inspect the state, and await their confirmation before taking any further action.

### 6. Sensitive & Destructive Commands
- **Ask for confirmation first:** Before executing any destructive, irreversible, or high-impact commands (e.g., `rm -rf`, `sudo`, `git push --force`, `git reset --hard`, modifying system configurations, killing arbitrary processes, dropping databases), **always ask the user for explicit permission** before sending the command with `terminal_write`.
- **State the intent & command:** Present the exact command line and explain what it does when asking for confirmation.


### 7. Password & Unknown Prompts
- If the terminal asks for a password (e.g., `sudo`, SSH passphrase) or information you do not have, **stop immediately**.
- Notify the user so they can provide the input directly via the terminal or web companion. Do not attempt to guess or send arbitrary inputs.
