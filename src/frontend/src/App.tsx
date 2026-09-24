import React, { useState } from 'react';
import { TerminalView } from './components/TerminalView';
import { Terminal as TerminalIcon, Wifi, WifiOff, Server, ShieldCheck, Activity } from 'lucide-react';

export const App: React.FC = () => {
  const [connected, setConnected] = useState<boolean>(false);
  const [status, setStatus] = useState<any>(null);

  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Navigation Bar */}
      <header className="h-12 bg-slate-900 border-b border-slate-800 flex items-center justify-between px-4 select-none shrink-0">
        <div className="flex items-center space-x-3">
          <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <TerminalIcon size={16} />
          </div>
          <div className="flex items-center space-x-2">
            <span className="font-semibold text-sm tracking-wide text-slate-100">Interminal</span>
            <span className="text-[10px] px-1.5 py-0.5 rounded bg-sky-500/10 text-sky-400 border border-sky-500/20 font-medium">MVP</span>
          </div>
        </div>

        {/* Center: Session Details */}
        <div className="flex items-center space-x-2 text-xs">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-300">
            <Server size={13} className="text-slate-400" />
            <span className="text-slate-400">Mode:</span>
            <span className="font-medium text-slate-200 uppercase">{status?.sessionType || 'local'}</span>
            {status?.target && <span className="text-sky-400 font-mono">({status.target})</span>}
          </div>

          {status?.pid && status.pid !== -1 && (
            <div className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800/80 border border-slate-700/60 text-slate-400 font-mono text-[11px]">
              <Activity size={12} className="text-emerald-400" />
              <span>PID: {status.pid}</span>
              <span className="text-slate-600">|</span>
              <span>{status?.cols}x{status?.rows}</span>
            </div>
          )}
        </div>

        {/* Right: Connection State */}
        <div className="flex items-center space-x-3 text-xs">
          <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800/50 border border-slate-700/40">
            {connected ? (
              <>
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-emerald-400 font-medium flex items-center gap-1">
                  <Wifi size={12} /> Connected
                </span>
              </>
            ) : (
              <>
                <span className="w-2 h-2 rounded-full bg-rose-500"></span>
                <span className="text-rose-400 font-medium flex items-center gap-1">
                  <WifiOff size={12} /> Disconnected
                </span>
              </>
            )}
          </div>
        </div>
      </header>

      {/* Main Terminal View Container */}
      <main className="flex-1 w-full relative overflow-hidden bg-[#0b0f19]">
        <TerminalView 
          onConnectionChange={setConnected}
          onStatusChange={setStatus}
        />
      </main>
    </div>
  );
};

export default App;
