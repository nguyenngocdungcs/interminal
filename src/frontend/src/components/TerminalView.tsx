import React, { useEffect, useRef } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebLinksAddon } from '@xterm/addon-web-links';

interface TerminalViewProps {
  onStatusChange?: (status: any) => void;
  onConnectionChange?: (connected: boolean) => void;
}

export const TerminalView: React.FC<TerminalViewProps> = ({
  onStatusChange,
  onConnectionChange,
}) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const terminalRef = useRef<Terminal | null>(null);
  const fitAddonRef = useRef<FitAddon | null>(null);
  const wsRef = useRef<WebSocket | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    // 1. Initialize Terminal
    const term = new Terminal({
      theme: {
        background: '#0b0f19',
        foreground: '#e2e8f0',
        cursor: '#38bdf8',
        cursorAccent: '#0b0f19',
        selectionBackground: 'rgba(56, 189, 248, 0.3)',
        black: '#1e293b',
        red: '#ef4444',
        green: '#10b981',
        yellow: '#f59e0b',
        blue: '#3b82f6',
        magenta: '#a855f7',
        cyan: '#06b6d4',
        white: '#f1f5f9',
        brightBlack: '#475569',
        brightRed: '#f87171',
        brightGreen: '#34d399',
        brightYellow: '#fbbf24',
        brightBlue: '#60a5fa',
        brightMagenta: '#c084fc',
        brightCyan: '#22d3ee',
        brightWhite: '#ffffff',
      },
      fontFamily: 'Menlo, Monaco, "Courier New", monospace',
      fontSize: 13,
      lineHeight: 1.25,
      cursorBlink: true,
      cursorStyle: 'block',
      allowProposedApi: true,
      scrollback: 10000,
    });

    const fitAddon = new FitAddon();
    const webLinksAddon = new WebLinksAddon();

    term.loadAddon(fitAddon);
    term.loadAddon(webLinksAddon);
    term.open(containerRef.current);
    fitAddon.fit();

    terminalRef.current = term;
    fitAddonRef.current = fitAddon;

    // 2. Establish WebSocket connection
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    // If running in Vite dev server (port 5173), connect directly to backend port 3010
    const host = window.location.port === '5173'
      ? `${window.location.hostname}:3010`
      : window.location.host;

    const wsUrl = `${protocol}//${host}/ws`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;

    ws.onopen = () => {
      onConnectionChange?.(true);
      // Inform server of initial dimensions
      if (term.cols && term.rows) {
        ws.send(JSON.stringify({
          type: 'resize',
          cols: term.cols,
          rows: term.rows,
        }));
      }
    };

    ws.onclose = () => {
      onConnectionChange?.(false);
      term.writeln('\r\n\x1b[31m[Interminal] Connection to backend lost. Reconnecting...\x1b[0m');
    };

    ws.onerror = () => {
      onConnectionChange?.(false);
    };

    ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        if (msg.type === 'output' && typeof msg.data === 'string') {
          term.write(msg.data);
        } else if (msg.type === 'status' && msg.status) {
          onStatusChange?.(msg.status);
        }
      } catch (e) {
        // Raw stream fallback
        term.write(event.data);
      }
    };

    // Forward human keystrokes to backend
    term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: 'input', data }));
      }
    });

    // Handle dynamic window resizing
    const handleResize = () => {
      if (fitAddonRef.current && terminalRef.current && wsRef.current?.readyState === WebSocket.OPEN) {
        fitAddonRef.current.fit();
        wsRef.current.send(JSON.stringify({
          type: 'resize',
          cols: terminalRef.current.cols,
          rows: terminalRef.current.rows,
        }));
      }
    };

    window.addEventListener('resize', handleResize);

    // Initial delayed fit to handle CSS rendering
    setTimeout(() => {
      fitAddon.fit();
      term.focus();
    }, 100);

    return () => {
      window.removeEventListener('resize', handleResize);
      ws.close();
      term.dispose();
    };
  }, []);

  return (
    <div 
      className="w-full h-full bg-[#0b0f19] relative overflow-hidden" 
      onClick={() => terminalRef.current?.focus()}
    >
      <div ref={containerRef} className="w-full h-full" />
    </div>
  );
};
