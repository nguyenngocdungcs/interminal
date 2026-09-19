# Reliable Command Lifecycle and Interactive Input Implementation Plan

> **For Hermes:** Use subagent-driven-development skill to implement this plan task-by-task.

**Goal:** Make Interminal correctly handle delayed-output commands such as `sleep.js` and multi-step interactive commands such as `prompt.js` without false completion, lost output, or input being consumed by the wrong process.

**Architecture:** Replace the current 300 ms output-silence completion heuristic with explicit shell lifecycle markers that carry a unique command ID and real exit code. Preserve blocking `execute_command` for ordinary commands, and add a non-blocking command API (`start_command`, `poll_command`, command-scoped `send_input`, and `cancel_command`) so an MCP client can alternate between reading prompts and submitting answers across separate tool calls.

**Tech Stack:** TypeScript, Node.js, `node-pty`, MCP TypeScript SDK, Zod, OSC 133/custom nonce lifecycle markers, Node test scripts.

---

## Current findings

### Reproduction: delayed output

- Interminal call: `execute_command({ command: "cd /Users/dungnguyen/Researching/interminal && node scripts/sleep.js 5", timeout_ms: 10000 })`
- Interminal returned immediately with only the echoed command and reported `exitCode: 0`, `success: true`.
- Native terminal execution waited five seconds and returned `You'd slept for 5 seconds` with exit code 0.

### Reproduction: interactive input

- `execute_command({ command: "node scripts/prompt.js" })` returned after the first prompt because output became quiet for 300 ms.
- The process was still awaiting input, but Interminal had already cleared `activeCommand` and marked the session idle.
- A later `send_input` wrote blindly to the shared PTY. A subsequent `execute_command` could therefore be consumed as an answer to the still-running prompt.

### Root cause

`src/backend/pty/pty-manager.ts:99-120` treats 300 ms of output silence as command completion and hard-codes exit code 0. Silence means only “no output right now”; it does not mean the shell command exited. This breaks delayed commands and interactive commands. The unscoped `send_input` tool then permits input and new commands to be mixed in the same PTY without ownership checks.

---

### Task 1: Define command state and lifecycle contracts

**Objective:** Introduce explicit types for running, completed, timed-out, and cancelled commands before changing behavior.

**Files:**
- Modify: `src/backend/pty/pty-manager.ts`
- Create: `tests/command-lifecycle.test.mjs`

**Step 1: Write failing state-contract tests**

Add tests asserting that a started command exposes:

```ts
interface CommandSnapshot {
  commandId: string;
  command: string;
  status: 'running' | 'exited' | 'timed_out' | 'cancelled';
  output: string;
  nextOffset: number;
  exitCode: number | null;
}
```

Test that command IDs are unique and that only one foreground command can own a single PTY session at a time.

**Step 2: Run the test and verify failure**

Run:

```bash
npx tsx tests/command-lifecycle.test.mjs
```

Expected: FAIL because the non-blocking command state API does not exist.

**Step 3: Implement minimal state storage**

Replace `activeCommand` with a command record containing:

- unique `commandId`
- original command
- lifecycle nonce
- raw and clean output buffers
- status
- nullable exit code
- timeout handle
- completion promise callbacks

Keep completed records in a small bounded history so final output can still be polled after exit; evict oldest records beyond a documented limit such as 20.

**Step 4: Run the test and verify pass**

Run `npx tsx tests/command-lifecycle.test.mjs`.

Expected: state and exclusivity tests PASS.

---

### Task 2: Replace idle completion with explicit shell markers

**Objective:** Detect actual command completion and its real exit code, regardless of output pauses.

**Files:**
- Modify: `src/backend/pty/pty-manager.ts:91-193`
- Modify: `tests/command-lifecycle.test.mjs`
- Modify: `tests/pty.test.mjs`

**Step 1: Add failing delayed-output and exit-code tests**

Add tests for:

```bash
node scripts/sleep.js 1
```

Expected output contains `You'd slept for 1 seconds`, and elapsed time is at least roughly one second.

Also test:

```bash
node -e "setTimeout(() => console.log('late'), 500)"
node -e "process.exit(7)"
```

Expected: the first command does not resolve before `late`; the second returns exit code 7.

**Step 2: Run tests and verify current failure**

Run:

```bash
npx tsx tests/command-lifecycle.test.mjs
```

Expected: FAIL because the 300 ms idle timer resolves before delayed output and always reports exit code 0.

**Step 3: Wrap commands with unique completion markers**

For local POSIX shells, write a wrapper equivalent to:

```sh
printf '<start-marker>'
{ <user command>; }
__interminal_ec=$?
printf '<end-marker:%s>' "$__interminal_ec"
```

Requirements:

- Generate an unpredictable per-command nonce and include it in both markers.
- Do not detect completion from ordinary prompt text or stream silence.
- Parse markers across chunk boundaries.
- Remove only Interminal’s own markers from the MCP-facing output.
- Preserve raw output for the WebSocket viewer.
- Return the real exit code from the end marker.
- Keep a timeout as a safety boundary, not as normal completion detection.
- Account for SSH sessions explicitly: either use a POSIX-compatible wrapper there too or document and test the supported remote shell requirement.

If existing OSC 133 hooks are reliable across supported shells, reuse them only when they include an unambiguous command boundary and exit code; otherwise use a private nonce marker.

**Step 4: Remove the idle debounce completion path**

Delete `idleTimer` and the `setTimeout(..., 300)` resolution logic. Output silence must never complete a command.

**Step 5: Run focused tests**

Run:

```bash
npx tsx tests/command-lifecycle.test.mjs
npx tsx tests/pty.test.mjs
```

Expected: delayed-output and non-zero-exit tests PASS.

---

### Task 3: Add a non-blocking interactive command API

**Objective:** Let an MCP client start a command, inspect output, send input, and inspect the next prompt over separate MCP calls.

**Files:**
- Modify: `src/backend/pty/pty-manager.ts`
- Modify: `src/backend/mcp/server.ts`
- Modify: `tests/command-lifecycle.test.mjs`

**Step 1: Write failing interactive lifecycle tests**

Test this sequence directly against `PtyManager`:

1. `startCommand('node scripts/prompt.js')` returns immediately with `status: running` and a `commandId`.
2. Poll until output contains `What is your name?`.
3. `sendInput(commandId, 'Alice\n')` succeeds.
4. Poll from the previous offset until output contains `How old are you?`.
5. `sendInput(commandId, '30\n')` succeeds.
6. Wait/poll until `status: exited`.
7. Final output contains `Your name is Alice and you are 30 years old.` and exit code is 0.

Also test rejection when:

- `commandId` is unknown or stale.
- `sendInput` targets an exited command.
- a second command starts while one is running.

**Step 2: Run and verify failure**

Run `npx tsx tests/command-lifecycle.test.mjs`.

Expected: FAIL because `startCommand`, `pollCommand`, and scoped input are absent.

**Step 3: Implement PTY manager methods**

Add methods with stable return shapes:

```ts
startCommand(command: string, timeoutMs?: number): CommandSnapshot
pollCommand(commandId: string, offset?: number): CommandSnapshot
sendInput(commandId: string, input: string): CommandSnapshot
cancelCommand(commandId: string): Promise<CommandSnapshot>
waitForCommand(commandId: string): Promise<CommandResult>
```

Behavior:

- `startCommand` writes the wrapped command and returns immediately.
- `pollCommand` returns output only from `offset`, plus `nextOffset`, status, and exit code.
- `sendInput` verifies ownership and running status before writing to the PTY.
- `cancelCommand` sends Ctrl+C and waits for a lifecycle marker or bounded cancellation timeout.
- `waitForCommand` powers the existing blocking API.

**Step 4: Expose MCP tools**

In `src/backend/mcp/server.ts`, add:

- `start_command(command, timeout_ms?)`
- `poll_command(command_id, offset?)`
- `cancel_command(command_id)`

Change `send_input` to require `command_id` and return structured JSON. Do not allow blind input to an idle shell through the agent-facing MCP tool; browser WebSocket keyboard input may remain a separate human-control path.

**Step 5: Keep backward-compatible blocking execution**

Implement `execute_command` as:

```ts
const started = ptyManager.startCommand(command, timeoutMs);
const result = await ptyManager.waitForCommand(started.commandId);
```

This gives ordinary commands correct delayed output and real exit codes while interactive callers use the non-blocking API.

**Step 6: Run focused tests**

Run `npx tsx tests/command-lifecycle.test.mjs`.

Expected: the complete prompt interaction and invalid-input tests PASS.

---

### Task 4: Verify MCP-level behavior for both failures

**Objective:** Confirm the MCP schemas and handlers preserve the PTY manager’s correct behavior.

**Files:**
- Create: `tests/mcp-tools.test.mjs` or extend an existing MCP test harness if one is introduced
- Modify: `tests/integration.test.mjs`

**Step 1: Add MCP handler tests**

Test `execute_command` with `node scripts/sleep.js 1` and assert:

- call duration is not prematurely shorter than the sleep
- output contains the completion message
- `exitCode` is 0
- `success` is true

Test the MCP interactive sequence:

```text
start_command(prompt.js)
poll_command -> name prompt
send_input(Alice)
poll_command -> age prompt
send_input(30)
poll_command -> exited + final result
```

**Step 2: Add lifecycle/error assertions**

Verify MCP returns `isError: true` or a structured failure for:

- wrong command ID
- second command while busy
- input after completion
- command timeout

Ensure timeouts report `status: timed_out` and do not claim exit code 0.

**Step 3: Run the integration suite**

Run:

```bash
npm test
```

Expected: all PTY, MCP, and WebSocket tests PASS.

---

### Task 5: Update documentation and manual acceptance checks

**Objective:** Document which MCP tool to use for blocking versus interactive commands and verify the exact reported failures are fixed.

**Files:**
- Modify: `README.md`
- Modify: `AGENTS.md` only if its lifecycle description no longer matches implementation

**Step 1: Document blocking usage**

Show `execute_command` with:

```json
{"command":"node scripts/sleep.js 5","timeout_ms":10000}
```

Expected response includes `You'd slept for 5 seconds` only after the command exits.

**Step 2: Document interactive usage**

Show the full command-ID flow using `start_command`, `poll_command`, and `send_input` for `scripts/prompt.js`.

Explain that MCP remains request/response based; interactivity is achieved through several short tool calls over server-managed command state, not by trying to inject input into one still-blocked MCP call.

**Step 3: Run manual acceptance tests through Hermes MCP**

Acceptance A:

1. Call Interminal `execute_command` with `node scripts/sleep.js 5`.
2. Verify it takes about five seconds.
3. Verify output includes `You'd slept for 5 seconds`.
4. Verify exit code 0.

Acceptance B:

1. Start `node scripts/prompt.js` with `start_command`.
2. Poll and observe the name prompt.
3. Send `Alice\n` with the returned command ID.
4. Poll and observe the age prompt.
5. Send `30\n`.
6. Poll until exited.
7. Verify final output is `Your name is Alice and you are 30 years old.`.

Acceptance C:

1. Run a command that exits 7.
2. Verify Interminal returns exit code 7 and `success: false`.

---

## Files likely to change

- `src/backend/pty/pty-manager.ts` — lifecycle markers, state machine, buffered polling, scoped input, cancellation
- `src/backend/mcp/server.ts` — new non-blocking tools and structured responses
- `tests/command-lifecycle.test.mjs` — delayed output, exit code, prompt flow, invalid state tests
- `tests/pty.test.mjs` — strengthen existing assertions
- `tests/integration.test.mjs` — WebSocket and MCP coexistence
- `tests/mcp-tools.test.mjs` — MCP schema/handler integration if a dedicated harness is practical
- `README.md` — blocking and interactive examples
- `AGENTS.md` — update lifecycle design notes if needed

## Risks and tradeoffs

- Shell wrapper quoting must not alter the user’s original command semantics. Prefer writing a wrapper around the command text without reparsing it in JavaScript.
- Lifecycle markers can arrive split across PTY chunks; parsing must retain an incomplete suffix between chunks.
- User output could theoretically contain marker-like text; a cryptographically random nonce makes collision negligible.
- Remote SSH shells may differ. Define the supported shell assumptions and add at least one fixture or mocked stream test.
- One PTY naturally supports one foreground command at a time. Multiple simultaneous jobs require multiple PTYs and are intentionally out of scope.
- Human WebSocket input and MCP input can still race. The UI should indicate command ownership, and backend writes should remain serialized.
- Completed command history must be bounded to avoid memory growth.

## Completion criteria

- Interminal waits for delayed output rather than resolving after 300 ms of silence.
- Real non-zero exit codes are returned.
- Interactive commands can be driven prompt-by-prompt through MCP calls.
- Input is command-scoped and cannot accidentally become a shell command or answer another command.
- Existing browser streaming and persistent `cd` behavior remain working.
- `npm test` passes and both manual acceptance scenarios succeed through the actual Interminal MCP tools.
