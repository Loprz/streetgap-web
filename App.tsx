import React, { useState, useEffect } from 'react';
import { StreetGapMap } from './components/StreetGapMap';
import { DataStatus, MapSettings, ProcessingStats } from './types';
import { DuckDBService } from './services/db';
import { Settings, Map, Database, Info, AlertTriangle, Layers, Navigation2 } from 'lucide-react';

const App: React.FC = () => {
  const [status, setStatus] = useState<DataStatus>(DataStatus.IDLE);
  const [stats, setStats] = useState<ProcessingStats>({
    loadedSegments: 0,
    processedCoverage: 0,
    undrivenSegments: 0,
    queryTimeMs: 0
  });

  const [settings, setSettings] = useState<MapSettings>({
    lookbackYears: 1,
    bufferSize: 15,
    showCoverage: false,
    mapillaryToken: '', // Ideally loaded from env or local storage
    routingMode: false
  });

  const [isSidebarOpen, setIsSidebarOpen] = useState(true);

  // Initialize DB on mount
  useEffect(() => {
    setStatus(DataStatus.LOADING_WASM);
    DuckDBService.getInstance().init()
      .then(() => setStatus(DataStatus.IDLE))
      .catch(() => setStatus(DataStatus.ERROR));
  }, []);

  const getStatusColor = (s: DataStatus) => {
    switch (s) {
      case DataStatus.READY: return 'text-green-400';
      case DataStatus.ERROR: return 'text-red-500';
      case DataStatus.IDLE: return 'text-gray-400';
      default: return 'text-yellow-400';
    }
  };

  return (
    <div className="flex h-screen w-screen overflow-hidden bg-slate-900 text-slate-200">
      {/* Sidebar */}
      <div className={`${isSidebarOpen ? 'w-80' : 'w-0'} bg-slate-950 border-r border-slate-800 transition-all duration-300 flex flex-col`}>
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-3xl font-black bg-clip-text text-transparent bg-gradient-to-r from-pink-500 to-yellow-500 tracking-tighter glow-pink">
            STREET<span className="text-white glow-yellow">GAP</span>
          </h1>
          <p className="text-xs text-slate-500 mt-1 uppercase tracking-widest font-semibold">Undriven Road Finder</p>
        </div>

        <div className="p-6 space-y-8 overflow-y-auto flex-1">
          {/* Status Panel */}
          <div className="space-y-2">
            <h2 className="text-xs uppercase text-slate-500 font-bold flex items-center gap-2">
              <Database size={14} /> System Status
            </h2>
            <div className={`text-sm font-mono font-bold ${getStatusColor(status)} flex items-center gap-2`}>
              {status === DataStatus.PROCESSING && <span className="animate-spin">◌</span>}
              {status}
            </div>
          </div>

          {/* Stats Panel */}
          <div className="space-y-2">
            <h2 className="text-xs uppercase text-slate-500 font-bold flex items-center gap-2">
              <Info size={14} /> Analysis Stats
            </h2>
            <div className="grid grid-cols-2 gap-4">
              <div className="bg-slate-900 p-3 rounded border border-slate-800 border-neon-pink">
                <div className="text-2xl font-mono text-pink-500 font-bold">{stats.undrivenSegments}</div>
                <div className="text-[10px] text-slate-400 uppercase font-black">Gaps Found</div>
              </div>
              <div className="bg-slate-900 p-3 rounded border border-slate-800 border-neon-yellow">
                <div className="text-2xl font-mono text-yellow-500 font-bold">{stats.queryTimeMs}ms</div>
                <div className="text-[10px] text-slate-400 uppercase font-black">Compute Time</div>
              </div>
            </div>
          </div>

          {/* Settings Panel */}
          <div className="space-y-4">
            <h2 className="text-xs uppercase text-slate-500 font-bold flex items-center gap-2">
              <Settings size={14} /> Configuration
            </h2>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Coverage Threshold (Meters)</label>
              <input
                type="range"
                min="5"
                max="50"
                value={settings.bufferSize}
                onChange={(e) => setSettings({ ...settings, bufferSize: parseInt(e.target.value) })}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-500"
              />
              <div className="text-right text-xs text-pink-400 font-mono">{settings.bufferSize}m</div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Mapillary Freshness (Years)</label>
              <input
                type="range"
                min="1"
                max="10"
                value={settings.lookbackYears}
                onChange={(e) => setSettings({ ...settings, lookbackYears: parseInt(e.target.value) })}
                className="w-full h-2 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
              />
              <div className="text-right text-xs text-yellow-400 font-mono">{settings.lookbackYears} {settings.lookbackYears === 1 ? 'Year' : 'Years'}</div>
            </div>

            <div className="space-y-1">
              <label className="text-xs font-semibold text-slate-300">Mapillary Client Token</label>
              <input
                type="password"
                placeholder="MLY|..."
                value={settings.mapillaryToken}
                onChange={(e) => setSettings({ ...settings, mapillaryToken: e.target.value })}
                className="w-full bg-slate-900 border border-slate-700 rounded px-3 py-2 text-xs text-white focus:outline-none focus:border-pink-500 transition-colors"
              />
              <p className="text-[10px] text-slate-600">Required for coverage data. Get one at mapillary.com</p>
            </div>

            {/* Routing Mode Toggle */}
            <div className="pt-2 border-t border-slate-800">
              <button
                onClick={() => setSettings({ ...settings, routingMode: !settings.routingMode })}
                className={`w-full flex items-center justify-between p-2 rounded transition-colors ${settings.routingMode ? 'bg-blue-900/40 text-blue-400 border border-blue-800' : 'bg-slate-900 text-slate-400 border border-slate-800'}`}
              >
                <div className="flex items-center gap-2">
                  <Navigation2 size={16} />
                  <span className="text-xs font-bold uppercase tracking-tight">Route Planner</span>
                </div>
                <div className={`w-8 h-4 rounded-full relative transition-colors ${settings.routingMode ? 'bg-blue-600' : 'bg-slate-700'}`}>
                  <div className={`absolute top-1 w-2 h-2 bg-white rounded-full transition-all ${settings.routingMode ? 'right-1' : 'left-1'}`}></div>
                </div>
              </button>
              {settings.routingMode && (
                <p className="text-[10px] text-blue-500/80 mt-1 font-medium italic">Click map to set start/end points.</p>
              )}
            </div>

            <div className="pt-2 border-t border-slate-800">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.showCoverage}
                  onChange={(e) => setSettings({ ...settings, showCoverage: e.target.checked })}
                  className="hidden"
                />
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${settings.showCoverage ? 'bg-pink-600 border-pink-500' : 'border-slate-600 group-hover:border-slate-400'}`}>
                  {settings.showCoverage && <div className="w-2 h-2 bg-white rounded-sm"></div>}
                </div>
                <span className="text-xs font-semibold text-slate-300">Show Mapillary Coverage Tile</span>
              </label>
            </div>
          </div>

          {/* Instructions */}
          <div className="bg-slate-900/50 p-4 rounded border border-slate-800 text-xs text-slate-400 leading-relaxed">
            <p className="mb-2"><strong className="text-slate-300">How to use:</strong></p>
            <ol className="list-decimal pl-4 space-y-1">
              <li>Enter a Mapillary Token.</li>
              <li>Zoom map to a neighborhood (Zoom 14+).</li>
              <li>Click <strong>SCAN THIS AREA</strong>.</li>
              <li>Pink lines indicate roads with no recent coverage.</li>
            </ol>
          </div>

        </div>

        {/* Community Credits */}
        <div className="p-6 border-t border-slate-800 bg-slate-950/50">
          <h3 className="text-[10px] font-black text-slate-500 uppercase tracking-widest mb-3">Community & Inspiration</h3>
          <div className="space-y-3">
            <a
              href="https://www.osm-verkehrswende.org/mapillary/posts/2025-10-12-mapillary-completeness-map/"
              target="_blank"
              rel="noopener noreferrer"
              className="block group"
            >
              <div className="text-[11px] font-bold text-slate-300 group-hover:text-pink-400 transition-colors">OSM Verkehrswende</div>
              <div className="text-[9px] text-slate-500 leading-tight">Berlin's Mapillary completeness tool that inspired our routing features.</div>
            </a>
          </div>
        </div>

        <div className="p-4 border-t border-slate-800 text-[10px] text-slate-600 flex justify-between">
          <span>v1.0.0 Alpha</span>
          <span>Powered by DuckDB-Wasm</span>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 relative">
        <button
          onClick={() => setIsSidebarOpen(!isSidebarOpen)}
          className="absolute top-4 left-4 z-50 bg-slate-950/80 backdrop-blur text-white p-2 rounded hover:bg-slate-900 transition-colors border border-slate-700"
        >
          {isSidebarOpen ? <Layers size={20} /> : <Settings size={20} />}
        </button>

        <StreetGapMap
          settings={settings}
          onStatusChange={setStatus}
          onStatsChange={setStats}
        />
      </div>
    </div>
  );
};

export default App;
