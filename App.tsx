import React, { useState, useEffect } from 'react';
import { StreetGapMap } from './components/StreetGapMap';
import { StreetLevelViewer } from './components/StreetLevelViewer';
import { DataStatus, MapSettings, ProcessingStats } from './types';
import { DuckDBService } from './services/db';
import { Settings, Map, Database, Info, AlertTriangle, Navigation2, PanelLeftClose, Menu } from 'lucide-react';

const App: React.FC = () => {
  const [status, setStatus] = useState<DataStatus>(DataStatus.IDLE);
  const [stats, setStats] = useState<ProcessingStats>({
    loadedSegments: 0,
    processedCoverage: 0,
    undrivenSegments: 0,
    queryTimeMs: 0
  });
  const [selectedImageId, setSelectedImageId] = useState<string | null>(null);

  const [settings, setSettings] = useState<MapSettings>(() => {
    const savedToken = localStorage.getItem('mapillaryToken');
    return {
      lookbackYears: 5,
      bufferSize: 15,
      showCoverage: true,
      showUndriven: true,
      showRoute: true,
      mapillaryToken: savedToken || '', // Loaded from local storage
      roadFilters: {
        residential: true,
        main: true,
        living: true,
        pedestrian: true,
        service: true // Default everything to true to show maximum data initially
      }
    };
  });

  // Save mapillary token to local storage whenever it changes
  useEffect(() => {
    if (settings.mapillaryToken) {
      localStorage.setItem('mapillaryToken', settings.mapillaryToken);
    }
  }, [settings.mapillaryToken]);

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
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 border-neon-pink border-breathe">
                <div className="text-2xl font-mono text-pink-500 font-bold glow-pink">{stats.undrivenSegments}</div>
                <div className="text-[10px] text-slate-400 uppercase font-black">Gaps Found</div>
              </div>
              <div className="bg-slate-900/80 p-3 rounded-lg border border-slate-800 border-neon-yellow border-breathe">
                <div className="text-2xl font-mono text-yellow-500 font-bold glow-yellow">{stats.queryTimeMs}ms</div>
                <div className="text-[10px] text-slate-400 uppercase font-black">Compute Time</div>
              </div>
            </div>
          </div>

          {/* Capture Workflow Panel */}
          <div className="space-y-4 bg-slate-900 border border-pink-900/50 rounded-lg p-4 relative overflow-hidden">
            <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-pink-500 to-yellow-500"></div>
            
            <h2 className="text-sm uppercase text-slate-300 font-bold flex items-center gap-2 mb-4">
              <Navigation2 size={16} className="text-pink-500" /> Capture Workflow
            </h2>

            {/* Step 1 */}
            <div className="space-y-4">
              <div className="text-xs font-bold text-pink-400">Step 1: Configure Data</div>
              
              <div className="space-y-1">
                <label className="text-[10px] font-semibold text-slate-300">Mapillary Client Token</label>
                <input
                  type="password"
                  placeholder="MLY|..."
                  value={settings.mapillaryToken}
                  onChange={(e) => setSettings({ ...settings, mapillaryToken: e.target.value })}
                  className={`w-full bg-slate-950 border rounded px-2 py-1.5 text-xs text-white focus:outline-none transition-colors ${settings.mapillaryToken ? 'border-green-600 focus:border-green-500' : 'border-red-800/60 focus:border-pink-500'}`}
                />
                {!settings.mapillaryToken ? (
                  <div className="mt-1.5 p-2 bg-red-950/40 border border-red-900/40 rounded text-[10px] text-slate-400 leading-relaxed space-y-1">
                    <p className="text-red-400 font-bold">⚠ Token Required</p>
                    <ol className="list-decimal pl-3 space-y-0.5">
                      <li>Go to <a href="https://www.mapillary.com/dashboard/developers" target="_blank" rel="noopener noreferrer" className="text-pink-400 underline hover:text-pink-300">mapillary.com/dashboard/developers</a></li>
                      <li>Click <strong className="text-slate-300">Register application</strong></li>
                      <li>Click <strong className="text-slate-300">View</strong> next to "Access Token"</li>
                      <li>Paste the <code className="text-pink-400">MLY|...</code> token above</li>
                    </ol>
                  </div>
                ) : (
                  <p className="text-[9px] text-green-500 font-medium mt-0.5">✓ Token saved</p>
                )}
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-300">Freshness</label>
                  <input
                    type="range"
                    min="1"
                    max="10"
                    value={settings.lookbackYears}
                    onChange={(e) => setSettings({ ...settings, lookbackYears: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-yellow-500"
                  />
                  <div className="text-right text-[9px] text-yellow-400 font-mono">{settings.lookbackYears} yrs</div>
                </div>
                <div className="space-y-1">
                  <label className="text-[10px] font-semibold text-slate-300">Tolerance</label>
                  <input
                    type="range"
                    min="5"
                    max="50"
                    value={settings.bufferSize}
                    onChange={(e) => setSettings({ ...settings, bufferSize: parseInt(e.target.value) })}
                    className="w-full h-1.5 bg-slate-800 rounded-lg appearance-none cursor-pointer accent-pink-500"
                  />
                  <div className="text-right text-[9px] text-pink-400 font-mono">{settings.bufferSize}m</div>
                </div>
              </div>
            </div>

            {/* Step 2 */}
            <div className={`space-y-2 pt-3 border-t border-slate-800 ${!settings.mapillaryToken ? 'opacity-50 grayscale' : 'opacity-100'}`}>
              <div className="text-xs font-bold text-orange-400">Step 2: Find Gaps</div>
              <p className="text-[10px] text-slate-400 leading-relaxed">
                Pan map to neighborhood, then click <strong className="text-pink-500">SCAN THIS AREA</strong>.
              </p>
            </div>

            {/* Step 3 */}
            <div className={`space-y-2 pt-3 border-t border-slate-800 ${stats.undrivenSegments === 0 ? 'opacity-50 grayscale' : 'opacity-100'}`}>
              <div className="text-xs font-bold text-yellow-400">Step 3: Plan Route</div>
              <p className="text-[10px] text-slate-400 mb-2">Connect gaps into an optimized path.</p>
              <div className="grid grid-cols-2 gap-2">
                <button 
                  disabled={stats.undrivenSegments === 0}
                  onClick={() => window.dispatchEvent(new CustomEvent('generate-route', { detail: { mode: 'driving' }}))}
                  className="bg-blue-600 hover:bg-blue-500 text-white text-[10px] font-bold py-2 rounded transition-colors uppercase disabled:cursor-not-allowed"
                >
                  Driving Route
                </button>
                <button 
                  disabled={stats.undrivenSegments === 0}
                  onClick={() => window.dispatchEvent(new CustomEvent('generate-route', { detail: { mode: 'foot' }}))}
                  className="bg-emerald-600 hover:bg-emerald-500 text-white text-[10px] font-bold py-2 rounded transition-colors uppercase disabled:cursor-not-allowed"
                >
                  Walking Route
                </button>
              </div>
            </div>

            {/* Step 4 */}
            <div className={`space-y-2 pt-3 border-t border-slate-800 ${stats.undrivenSegments === 0 ? 'opacity-50 grayscale' : 'opacity-100'}`}>
              <div className="text-xs font-bold text-emerald-400">Step 4: Export & Drive</div>
              <p className="text-[10px] text-slate-400 mb-2">Export to Guru Maps/CarPlay for navigation.</p>
              <button 
                disabled={stats.undrivenSegments === 0}
                onClick={() => window.dispatchEvent(new CustomEvent('export-route'))}
                className="w-full bg-slate-700 hover:bg-slate-600 text-white text-[10px] font-bold py-2 flex justify-center items-center gap-2 rounded transition-colors uppercase disabled:cursor-not-allowed"
              >
                Export Route as GPX
              </button>
            </div>
          </div>

          {/* Visibility Toggles */}
          <div className="space-y-3 pt-4 border-t border-slate-800">
            <h2 className="text-xs uppercase text-slate-500 font-bold flex items-center gap-2 mb-2">
              <Settings size={14} /> Display Options
            </h2>

            <div className="pt-2 border-t border-slate-800 space-y-3">
              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.showRoute}
                  onChange={(e) => setSettings({ ...settings, showRoute: e.target.checked })}
                  className="hidden"
                />
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${settings.showRoute ? 'bg-blue-500 border-blue-400' : 'border-slate-600 group-hover:border-slate-400'}`}>
                  {settings.showRoute && <div className="w-2 h-2 bg-white rounded-sm"></div>}
                </div>
                <span className="text-xs font-semibold text-slate-300">Show Generated Route</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.showUndriven}
                  onChange={(e) => setSettings({ ...settings, showUndriven: e.target.checked })}
                  className="hidden"
                />
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${settings.showUndriven ? 'bg-pink-600 border-pink-500' : 'border-slate-600 group-hover:border-slate-400'}`}>
                  {settings.showUndriven && <div className="w-2 h-2 bg-white rounded-sm"></div>}
                </div>
                <span className="text-xs font-semibold text-slate-300">Show Undriven Gaps</span>
              </label>

              <label className="flex items-center gap-2 cursor-pointer group">
                <input
                  type="checkbox"
                  checked={settings.showCoverage}
                  onChange={(e) => setSettings({ ...settings, showCoverage: e.target.checked })}
                  className="hidden"
                />
                <div className={`w-4 h-4 rounded border flex items-center justify-center transition-colors ${settings.showCoverage ? 'bg-green-600 border-green-500' : 'border-slate-600 group-hover:border-slate-400'}`}>
                  {settings.showCoverage && <div className="w-2 h-2 bg-white rounded-sm"></div>}
                </div>
                <span className="text-xs font-semibold text-slate-300">Show Mapillary Coverage Tile</span>
              </label>
            </div>
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
      <div className="flex-1 flex overflow-hidden">
        <div className={`relative h-full transition-all duration-300 ${selectedImageId ? 'w-[60%]' : 'w-full'}`}>
          <button
            onClick={() => setIsSidebarOpen(!isSidebarOpen)}
            className="absolute top-6 left-6 z-50 bg-slate-950/90 backdrop-blur text-white p-2.5 rounded-lg hover:bg-pink-600 transition-colors border border-slate-700 shadow-lg"
            title={isSidebarOpen ? "Close Sidebar" : "Open Sidebar"}
          >
            {isSidebarOpen ? <PanelLeftClose size={20} /> : <Menu size={20} />}
          </button>

          <StreetGapMap
            settings={settings}
            status={status}
            onStatusChange={setStatus}
            onStatsChange={setStats}
            onImageSelect={setSelectedImageId}
          />

        {/* Dynamic Legend & Filters */}
        {settings.showUndriven && (
          <div className="absolute bottom-8 right-8 z-50 bg-slate-950/90 backdrop-blur border border-slate-800 rounded-lg p-4 shadow-2xl">
            <h4 className="text-[10px] font-black text-slate-400 uppercase tracking-widest mb-3">Undriven Gaps Filters</h4>
            <div className="space-y-2.5 text-xs font-semibold text-slate-300">
              
              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" className="hidden" checked={settings.roadFilters.residential} 
                  onChange={(e) => setSettings({...settings, roadFilters: {...settings.roadFilters, residential: e.target.checked}})} />
                <div className={`w-3 h-3 rounded flex flex-shrink-0 items-center justify-center transition-colors ${settings.roadFilters.residential ? 'bg-slate-700' : 'border border-slate-600'}`}>
                   {settings.roadFilters.residential && <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>}
                </div>
                <span className={`w-6 h-1 rounded-full bg-[#FF1493] ${settings.roadFilters.residential ? 'shadow-[0_0_8px_rgba(255,20,147,0.6)]' : 'opacity-30'}`}></span>
                <span className={settings.roadFilters.residential ? '' : 'opacity-40 line-through'}>Residential / Local</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" className="hidden" checked={settings.roadFilters.main} 
                  onChange={(e) => setSettings({...settings, roadFilters: {...settings.roadFilters, main: e.target.checked}})} />
                <div className={`w-3 h-3 rounded flex flex-shrink-0 items-center justify-center transition-colors ${settings.roadFilters.main ? 'bg-slate-700' : 'border border-slate-600'}`}>
                   {settings.roadFilters.main && <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>}
                </div>
                <span className={`w-6 h-1 rounded-full bg-[#FF8C00] ${settings.roadFilters.main ? 'shadow-[0_0_8px_rgba(255,140,0,0.6)]' : 'opacity-30'}`}></span>
                <span className={settings.roadFilters.main ? '' : 'opacity-40 line-through'}>Main Roads / Arterial</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" className="hidden" checked={settings.roadFilters.living} 
                  onChange={(e) => setSettings({...settings, roadFilters: {...settings.roadFilters, living: e.target.checked}})} />
                <div className={`w-3 h-3 rounded flex flex-shrink-0 items-center justify-center transition-colors ${settings.roadFilters.living ? 'bg-slate-700' : 'border border-slate-600'}`}>
                   {settings.roadFilters.living && <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>}
                </div>
                <span className={`w-6 h-1 rounded-full bg-[#FFD700] ${settings.roadFilters.living ? 'shadow-[0_0_8px_rgba(255,215,0,0.6)]' : 'opacity-30'}`}></span>
                <span className={settings.roadFilters.living ? '' : 'opacity-40 line-through'}>Living / Shared Streets</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" className="hidden" checked={settings.roadFilters.pedestrian} 
                  onChange={(e) => setSettings({...settings, roadFilters: {...settings.roadFilters, pedestrian: e.target.checked}})} />
                <div className={`w-3 h-3 rounded flex flex-shrink-0 items-center justify-center transition-colors ${settings.roadFilters.pedestrian ? 'bg-slate-700' : 'border border-slate-600'}`}>
                   {settings.roadFilters.pedestrian && <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>}
                </div>
                <span className={`w-6 h-1 rounded-full bg-[#00FFFF] ${settings.roadFilters.pedestrian ? 'shadow-[0_0_8px_rgba(0,255,255,0.6)]' : 'opacity-30'}`}></span>
                <span className={settings.roadFilters.pedestrian ? '' : 'opacity-40 line-through'}>Pedestrian / Cycle</span>
              </label>

              <label className="flex items-center gap-3 cursor-pointer group">
                <input type="checkbox" className="hidden" checked={settings.roadFilters.service} 
                  onChange={(e) => setSettings({...settings, roadFilters: {...settings.roadFilters, service: e.target.checked}})} />
                <div className={`w-3 h-3 rounded flex flex-shrink-0 items-center justify-center transition-colors ${settings.roadFilters.service ? 'bg-slate-700' : 'border border-slate-600'}`}>
                   {settings.roadFilters.service && <div className="w-1.5 h-1.5 bg-white rounded-sm"></div>}
                </div>
                <span className={`w-6 h-1 rounded-full bg-[#696969] ${settings.roadFilters.service ? 'shadow-[0_0_8px_rgba(105,105,105,0.6)]' : 'opacity-30'}`}></span>
                <span className={settings.roadFilters.service ? '' : 'opacity-40 line-through'}>Service / Private</span>
              </label>

            </div>
          </div>
        )}
        </div>
        
        {/* Street-Level Viewer Panel */}
        {selectedImageId && (
          <div className="w-[40%] h-full shrink-0">
            <StreetLevelViewer
              imageId={selectedImageId}
              accessToken={settings.mapillaryToken}
              onClose={() => setSelectedImageId(null)}
            />
          </div>
        )}
      </div>
    </div>
  );
};

export default App;
