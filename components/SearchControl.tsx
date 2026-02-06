import React, { useState, useEffect, useRef } from 'react';
import { Search, MapPin, X } from 'lucide-react';

interface SearchResult {
    properties: {
        name: string;
        city?: string;
        state?: string;
        country?: string;
        extent?: [number, number, number, number];
    };
    geometry: {
        coordinates: [number, number];
    };
}

interface Props {
    onSelect: (lon: number, lat: number, extent?: [number, number, number, number]) => void;
}

export const SearchControl: React.FC<Props> = ({ onSelect }) => {
    const [query, setQuery] = useState('');
    const [results, setResults] = useState<SearchResult[]>([]);
    const [isOpen, setIsOpen] = useState(false);
    const [isLoading, setIsLoading] = useState(false);
    const containerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const handleClickOutside = (event: MouseEvent) => {
            if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
                setIsOpen(false);
            }
        };
        document.addEventListener('mousedown', handleClickOutside);
        return () => document.removeEventListener('mousedown', handleClickOutside);
    }, []);

    useEffect(() => {
        const timer = setTimeout(async () => {
            if (query.length < 3) {
                setResults([]);
                return;
            }

            setIsLoading(true);
            try {
                const response = await fetch(`https://photon.komoot.io/api/?q=${encodeURIComponent(query)}&limit=5`);
                const data = await response.json();
                setResults(data.features || []);
                setIsOpen(true);
            } catch (err) {
                console.error('Search error:', err);
            } finally {
                setIsLoading(false);
            }
        }, 300);

        return () => clearTimeout(timer);
    }, [query]);

    return (
        <div ref={containerRef} className="relative w-full max-w-md">
            <div className="relative group">
                <div className="absolute inset-y-0 left-4 flex items-center pointer-events-none">
                    <Search size={18} className={`${isLoading ? 'animate-pulse text-pink-500' : 'text-slate-400'} group-focus-within:text-pink-500 transition-colors`} />
                </div>
                <input
                    type="text"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    placeholder="SEARCH AREA..."
                    className="w-full bg-slate-900/80 backdrop-blur-xl border-2 border-slate-700/50 focus:border-pink-500/50 rounded-2xl py-3 pl-12 pr-12 text-white placeholder-slate-500 outline-none transition-all shadow-2xl focus:shadow-[0_0_20px_rgba(236,72,153,0.15)] uppercase tracking-wider font-bold text-sm"
                    onFocus={() => query.length >= 3 && setIsOpen(true)}
                />
                {query && (
                    <button
                        onClick={() => setQuery('')}
                        className="absolute inset-y-0 right-4 flex items-center text-slate-500 hover:text-white transition-colors"
                    >
                        <X size={18} />
                    </button>
                )}
            </div>

            {isOpen && results.length > 0 && (
                <div className="absolute top-full mt-2 w-full bg-slate-900/95 backdrop-blur-2xl border-2 border-slate-700/50 rounded-2xl shadow-2xl overflow-hidden z-[100] animate-in fade-in slide-in-from-top-2 duration-200">
                    {results.map((result, index) => {
                        const { name, city, state, country } = result.properties;
                        const subtitle = [city, state, country].filter(Boolean).join(', ');

                        return (
                            <button
                                key={index}
                                onClick={() => {
                                    onSelect(result.geometry.coordinates[0], result.geometry.coordinates[1], result.properties.extent);
                                    setIsOpen(false);
                                    setQuery(name);
                                }}
                                className="w-full flex items-start gap-3 p-4 hover:bg-pink-500/10 text-left transition-colors border-b border-slate-800 last:border-0 group"
                            >
                                <div className="mt-1 p-2 bg-slate-800 rounded-lg group-hover:bg-pink-500/20 group-hover:text-pink-500 transition-colors">
                                    <MapPin size={16} />
                                </div>
                                <div>
                                    <div className="font-bold text-white text-sm uppercase tracking-tight">{name}</div>
                                    {subtitle && <div className="text-slate-400 text-xs mt-0.5">{subtitle}</div>}
                                </div>
                            </button>
                        );
                    })}
                </div>
            )}
        </div>
    );
};
