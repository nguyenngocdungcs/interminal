import React from 'react';
import { TerminalView } from './components/TerminalView';
import { Terminal as TerminalIcon } from 'lucide-react';

export const App: React.FC = () => {
  return (
    <div className="flex flex-col h-screen w-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Navigation Bar */}
      <header className="h-11 bg-slate-900 border-b border-slate-800 flex items-center px-4 select-none shrink-0">
        <div className="flex items-center space-x-2.5">
          <div className="flex items-center justify-center w-6 h-6 rounded-md bg-sky-500/10 text-sky-400 border border-sky-500/20">
            <TerminalIcon size={14} />
          </div>
          <span className="font-semibold text-sm tracking-wide text-slate-100">Interminal</span>
        </div>
      </header>

      {/* Main Terminal View Container */}
      <main className="flex-1 w-full relative overflow-hidden bg-[#0b0f19]">
        <TerminalView />
      </main>
    </div>
  );
};

export default App;
