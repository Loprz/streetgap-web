import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { BoundingBox, DataStatus, MapSettings, ProcessingStats } from '../types';
import { ArrowBigRightDash, Map } from 'lucide-react';
import { SearchControl } from './SearchControl';
import { AnalysisService } from '../services/analysis';
import { RoutingService } from '../services/routing';
import { exportToGPX } from '../utils/export';

// Extend the GeoJSON source to allow us to define custom layer paint properties
interface Props {
  settings: MapSettings;
  status: DataStatus;
  onStatusChange: (status: DataStatus) => void;
  onStatsChange: (stats: ProcessingStats) => void;
}

export const StreetGapMap: React.FC<Props> = ({ settings, status, onStatusChange, onStatsChange }) => {
  const mapContainer = useRef<HTMLDivElement>(null);
  const map = useRef<maplibregl.Map | null>(null);
  const [isMapReady, setIsMapReady] = useState(false);
  const [currentZoom, setCurrentZoom] = useState(14);
  const [routingPoints, setRoutingPoints] = useState<[number, number][]>([]);
  const startMarker = useRef<maplibregl.Marker | null>(null);
  const endMarker = useRef<maplibregl.Marker | null>(null);

  // Initialize Map
  useEffect(() => {
    if (map.current || !mapContainer.current) return;

    try {
      map.current = new maplibregl.Map({
        container: mapContainer.current,
        style: 'https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json',
        center: [-122.4194, 37.7749], // San Francisco
        zoom: 14,
      });

      // Add Controls
      map.current.addControl(
        new maplibregl.NavigationControl({ showCompass: false }),
        'top-right'
      );

      const geolocate = new maplibregl.GeolocateControl({
        positionOptions: { enableHighAccuracy: true },
        trackUserLocation: true,
        showUserLocation: true
      });
      map.current.addControl(geolocate, 'top-right');

      map.current.on('load', () => {
        setIsMapReady(true);
        onStatusChange(DataStatus.IDLE);
        // ... existing code ...
        // Add Route Source
        map.current?.addSource('route-source', {
          type: 'geojson',
          data: { type: 'FeatureCollection', features: [] }
        });

        map.current?.addLayer({
          id: 'route-layer',
          type: 'line',
          source: 'route-source',
          layout: { 'line-join': 'round', 'line-cap': 'round' },
          paint: {
            'line-color': '#00BFFF', // Deep Sky Blue for the route
            'line-width': 6,
            'line-opacity': 0.7
          }
        });
      });

      map.current.on('error', (e: any) => {
        if (e && e.error && typeof e.error.message === 'string' && 
            (e.error.message.includes('404') || e.error.message.includes('403') || e.error.message.includes('401'))) {
          return;
        }
        if (e.tile) {
          return; // Suppress missing tile errors to avoid console spam
        }
        console.error("StreetGapMap: Map error", e);
      });
    } catch (err) {
      console.error("StreetGapMap: Error during initialization", err);
    }

    // Cleanup
    return () => {
      map.current?.remove();
      map.current = null;
      setIsMapReady(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleSearchSelect = useCallback((lon: number, lat: number, extent?: [number, number, number, number]) => {
    if (!map.current) return;

    if (extent) {
      map.current.fitBounds([
        [extent[0], extent[1]],
        [extent[2], extent[3]]
      ], { padding: 40 });
    } else {
      map.current.flyTo({
        center: [lon, lat],
        zoom: 15,
        essential: true
      });
    }
  }, []);
  // ... existing runAnalysis, fetchRoute, etc ...
  const runAnalysis = useCallback(async () => {
    if (!map.current) return;

    const bounds = map.current.getBounds();
    const bbox: BoundingBox = {
      minLon: bounds.getWest(),
      minLat: bounds.getSouth(),
      maxLon: bounds.getEast(),
      maxLat: bounds.getNorth(),
    };

    // Only run if zoom is sufficient to avoid massive data fetches
    if (map.current.getZoom() < 13) {
      console.warn("Zoom level too low for detailed analysis");
      return;
    }

    try {
      onStatusChange(DataStatus.PROCESSING);

      // Extract Mapillary Vector features from the currently loaded map style in memory
      const cutoffMs = Date.now() - (settings.lookbackYears * 365.25 * 24 * 60 * 60 * 1000);
      let coverageGeoJson: any = { type: "FeatureCollection", features: [] };

      if (settings.mapillaryToken) {
        // Find visible mapillary geometries directly from the vector tiles mapped to long/lat GeoJSON
        const features = map.current.querySourceFeatures('mapillary-mvt', { sourceLayer: 'sequence' });
        
        // Filter out coverage that is older than our allowed threshold
        const filteredCoverage = features.filter(f => {
          return f.properties && f.properties.captured_at >= cutoffMs;
        });

        coverageGeoJson.features = filteredCoverage.map(f => ({
          type: "Feature",
          geometry: f.geometry,
          properties: f.properties
        }));
      }

      // Pass the coverage GeoJSON down to the analysis service!
      const result = await AnalysisService.runCoverageAnalysis(
        bbox, 
        settings, 
        coverageGeoJson, 
        (s) => onStatusChange(s as DataStatus)
      );

      // 5. Update Coverage Layer (Removed redundant yellow dots)
      // Visual feedback is cleanly handled by the green mapillary-mvt-layer directly.

      // 6. Update Undriven Layer
      if (map.current.getSource('undriven-source')) {
        (map.current.getSource('undriven-source') as maplibregl.GeoJSONSource).setData(result.undrivenGeoJson);
      } else {
        map.current.addSource('undriven-source', {
          type: 'geojson',
          data: result.undrivenGeoJson
        });
        map.current.addLayer({
          id: 'undriven-layer',
          type: 'line',
          source: 'undriven-source',
          layout: {
            'line-join': 'round',
            'line-cap': 'round'
          },
          paint: {
            'line-color': [
              'match',
              ['get', 'class'],
              ['residential', 'unclassified'], '#FF1493', // Deep Pink (Prime targets)
              ['primary', 'secondary', 'tertiary', 'trunk'], '#FF8C00', // Dark Orange (Main roads)
              ['living_street'], '#FFD700', // Gold (Slow/Shared)
              ['footway', 'pedestrian', 'path', 'track', 'steps', 'cycleway'], '#00FFFF', // Cyan (Walking)
              ['service', 'driveway', 'parking_aisle', 'parking'], '#696969', // Dim Gray (Private/Inaccessible)
              '#FF00FF' // Fallback Neon Pink
            ],
            'line-width': [
              'match',
              ['get', 'class'],
              ['primary', 'secondary', 'trunk'], 5,
              ['footway', 'pedestrian', 'path'], 2,
              ['service', 'driveway', 'parking_aisle'], 2,
              4 // Default width
            ],
            'line-opacity': [
              'match',
              ['get', 'class'],
              ['service', 'driveway', 'parking_aisle', 'parking'], 0.4, // Dim the inaccessible roads
              0.8 // Default opacity
            ]
          }
        });
      }

      // Update Stats
      onStatsChange({
        loadedSegments: 0,
        processedCoverage: result.stats.coveragePointsProcessed,
        undrivenSegments: result.stats.undrivenSegmentsCount,
        queryTimeMs: result.stats.queryTimeMs
      });

      onStatusChange(DataStatus.READY);

    } catch (e) {
      console.error("Analysis Failed", e);
      onStatusChange(DataStatus.ERROR);
    }
  }, [settings, onStatusChange, onStatsChange]);

  const fetchRoute = useCallback(async (points: [number, number][]) => {
    const featureCollection = await RoutingService.fetchRoute(points);
    if (featureCollection && map.current) {
      (map.current.getSource('route-source') as maplibregl.GeoJSONSource).setData(featureCollection);
    }
  }, []);

  // Handle Click for Routing
  useEffect(() => {
    if (!map.current || !isMapReady) return;
    const m = map.current;

    const handleMapClick = (e: maplibregl.MapMouseEvent) => {
      if (!settings.routingMode) return;

      const newPoint: [number, number] = [e.lngLat.lng, e.lngLat.lat];

      setRoutingPoints(prev => {
        const updated = prev.length >= 2 ? [newPoint] : [...prev, newPoint];

        // Update Markers
        if (updated.length === 1) {
          if (!startMarker.current) {
            startMarker.current = new maplibregl.Marker({ color: '#00FF00' }).setLngLat(newPoint).addTo(m);
          } else {
            startMarker.current.setLngLat(newPoint);
          }
          if (endMarker.current) endMarker.current.remove();
          endMarker.current = null;
          // Clear route
          (m.getSource('route-source') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
        } else if (updated.length === 2) {
          if (!endMarker.current) {
            endMarker.current = new maplibregl.Marker({ color: '#FF0000' }).setLngLat(newPoint).addTo(m);
          } else {
            endMarker.current.setLngLat(newPoint);
          }
          fetchRoute(updated);
        }

        return updated;
      });
    };

    m.on('click', handleMapClick);
    return () => { m.off('click', handleMapClick); };
  }, [isMapReady, settings.routingMode, fetchRoute]);

  // Clear routing markers when disabling routing mode
  useEffect(() => {
    if (!settings.routingMode) {
      startMarker.current?.remove();
      startMarker.current = null;
      endMarker.current?.remove();
      endMarker.current = null;
      setRoutingPoints([]);
      if (map.current?.getSource('route-source')) {
        (map.current.getSource('route-source') as maplibregl.GeoJSONSource).setData({ type: 'FeatureCollection', features: [] });
      }
    }
  }, [settings.routingMode]);

  // Handle Automated Route Generation
  useEffect(() => {
    if (!map.current || !isMapReady) return;
    const m = map.current;

    const handleGenerateRoute = async (e: Event) => {
      const customEvent = e as CustomEvent;
      const mode = customEvent.detail.mode as 'driving' | 'foot';

      onStatusChange(DataStatus.PROCESSING);
      
      try {
        // Extract the current pink undriven lines from the map source
        const undrivenSource = m.getSource('undriven-source') as maplibregl.GeoJSONSource;
        if (!undrivenSource) {
           console.warn("No undriven roads calculated yet.");
           onStatusChange(DataStatus.READY);
           return;
        }

        // maplibregl doesn't expose a clean getter for source data unfortunately,
        // so we use queryRenderedFeatures against the undriven-layer
        let undrivenFeatures = m.queryRenderedFeatures(undefined, { layers: ['undriven-layer'] });

        if (undrivenFeatures.length === 0) {
           console.warn("No visible undriven roads to route through.");
           onStatusChange(DataStatus.READY);
           return;
        }

        // Filter by Overture class
        const drivingClasses = ['residential', 'primary', 'secondary', 'tertiary', 'living_street', 'trunk', 'unclassified'];
        const walkingClasses = ['footway', 'pedestrian', 'path', 'track', 'steps', 'cycleway'];

        undrivenFeatures = undrivenFeatures.filter(f => {
            const roadClass = f.properties?.class;
            if (mode === 'driving') return drivingClasses.includes(roadClass);
            if (mode === 'foot') return walkingClasses.includes(roadClass);
            return true; 
        });

        // Clear existing markers since we're generating a bulk trip line
        startMarker.current?.remove();
        startMarker.current = null;
        endMarker.current?.remove();
        endMarker.current = null;
        setRoutingPoints([]);

        const featureCollection = await RoutingService.generateTrip(undrivenFeatures, mode);
        
        if (featureCollection) {
          (m.getSource('route-source') as maplibregl.GeoJSONSource).setData(featureCollection);
        } else {
          console.warn("OSRM returned no viable trip spanning these segments.");
        }
        onStatusChange(DataStatus.READY);
      } catch (err) {
        console.error("Trip Generation Error:", err);
        onStatusChange(DataStatus.ERROR);
      }
    };

    window.addEventListener('generate-route', handleGenerateRoute);
    return () => window.removeEventListener('generate-route', handleGenerateRoute);
  }, [isMapReady, onStatusChange]);

  // Handle Export Route to GPX
  useEffect(() => {
    if (!map.current || !isMapReady) return;
    const m = map.current;

    const handleExportRoute = () => {
      try {
        const routeSource = m.getSource('route-source') as maplibregl.GeoJSONSource;
        if (!routeSource) {
           console.warn("No route generated yet to export.");
           return;
        }

        // To access the data of a GeoJSONSource safely without relying on unstable internals,
        // we use querySourceFeatures to pull out all the routing segments we currently have
        const routeFeatures = m.querySourceFeatures('route-source');
        
        if (!routeFeatures || routeFeatures.length === 0) {
           console.warn("Route is empty, nothing to export.");
           return;
        }

        const featureCollection = {
          type: "FeatureCollection" as const,
          features: routeFeatures.map(f => ({
            type: "Feature" as const,
            properties: f.properties || {},
            geometry: f.geometry
          }))
        };

        const gpxString = exportToGPX(featureCollection, "StreetGap Captured Route");
        
        // Trigger browser download
        const blob = new Blob([gpxString], { type: 'application/gpx+xml' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `streetgap_route_${new Date().getTime()}.gpx`;
        document.body.appendChild(a);
        a.click();
        
        // Cleanup
        setTimeout(() => {
          document.body.removeChild(a);
          window.URL.revokeObjectURL(url);
        }, 100);

      } catch (err) {
        console.error("Export Error:", err);
      }
    };

    window.addEventListener('export-route', handleExportRoute);
    return () => window.removeEventListener('export-route', handleExportRoute);
  }, [isMapReady]);

  // Handle Coverage Visibility
  useEffect(() => {
    if (!isMapReady || !map.current) return;
    const m = map.current;

    const mvtSourceId = 'mapillary-mvt';
    const mvtLayerId = 'mapillary-mvt-layer';

    const updateLayer = () => {
      // Validate the map is fully loaded before trying to add/update style sources
      if (!m.isStyleLoaded()) {
        m.once('styledata', updateLayer);
        return;
      }

      // Calculate UNIX timestamp in milliseconds for the cutoff date
      const cutoffMs = Date.now() - (settings.lookbackYears * 365.25 * 24 * 60 * 60 * 1000);

      if (settings.showCoverage && settings.mapillaryToken) {
        if (!m.getSource(mvtSourceId)) {
          try {
            // Add the official Mapillary Vector Tile layer for instant feedback
            m.addSource(mvtSourceId, {
              type: 'vector',
              tiles: [
                `https://tiles.mapillary.com/maps/vtp/mly1_public/2/{z}/{x}/{y}?access_token=${settings.mapillaryToken}`
              ],
              minzoom: 6,
              maxzoom: 14
            });
            m.addLayer({
              id: mvtLayerId,
              type: 'line',
              source: mvtSourceId,
              'source-layer': 'sequence',
              filter: ['>=', ['get', 'captured_at'], cutoffMs],
              layout: {
                'line-cap': 'round',
                'line-join': 'round',
                'visibility': 'visible'
              },
              paint: {
                'line-opacity': 0.6,
                'line-color': '#05CB63', // Mapillary green
                'line-width': 2
              }
            });
          } catch (e) {
            console.error("Failed to add Mapillary MVT layer", e);
          }
        } else {
          if (m.getLayer(mvtLayerId)) {
            m.setLayoutProperty(mvtLayerId, 'visibility', 'visible');
            m.setFilter(mvtLayerId, ['>=', ['get', 'captured_at'], cutoffMs]);
          }
        }
      } else {
        if (m.getLayer(mvtLayerId)) {
          m.setLayoutProperty(mvtLayerId, 'visibility', 'none');
        }
      }

      // Enforce Z-indexing whenever Mapillary loads so it stays on bottom
      if (m.getLayer('undriven-layer')) m.moveLayer('undriven-layer');
      if (m.getLayer('route-layer')) m.moveLayer('route-layer');

    };

    updateLayer();
  }, [isMapReady, settings.showCoverage, settings.mapillaryToken, settings.lookbackYears]);

  // Handle Route and Undriven Layer Visibility & Z-Indexing
  useEffect(() => {
    if (!isMapReady || !map.current) return;
    const m = map.current;

    // Toggle Undriven Gaps Layer Visibility and Class Filters
    if (m.getLayer('undriven-layer')) {
      m.setLayoutProperty('undriven-layer', 'visibility', settings.showUndriven ? 'visible' : 'none');

      // Build the MapLibre filter array dynamically based on active UI toggles
      const activeClasses: string[] = [];
      if (settings.roadFilters.residential) activeClasses.push('residential', 'unclassified');
      if (settings.roadFilters.main) activeClasses.push('primary', 'secondary', 'tertiary', 'trunk');
      if (settings.roadFilters.living) activeClasses.push('living_street');
      if (settings.roadFilters.pedestrian) activeClasses.push('footway', 'pedestrian', 'path', 'track', 'steps', 'cycleway');
      if (settings.roadFilters.service) activeClasses.push('service', 'driveway', 'parking_aisle', 'parking');

      if (activeClasses.length > 0) {
        m.setFilter('undriven-layer', ['in', ['get', 'class'], ['literal', activeClasses]]);
      } else {
        // If everything is turned off, apply a filter that matches nothing
        m.setFilter('undriven-layer', ['==', 'class', 'NONE']);
      }
    }

    // Toggle Generated Route Layer
    if (m.getLayer('route-layer')) {
      m.setLayoutProperty('route-layer', 'visibility', settings.showRoute ? 'visible' : 'none');
    }
    
    // Enforce strict Z-Index order: Mapillary (bottom) -> Undriven -> Route (top)
    if (m.getLayer('undriven-layer')) m.moveLayer('undriven-layer');
    if (m.getLayer('route-layer')) m.moveLayer('route-layer');

  }, [isMapReady, settings.showUndriven, settings.showRoute, settings.roadFilters]);

  // Hook up the moveend listener
  useEffect(() => {
    if (!isMapReady || !map.current) return;

    const m = map.current;

    const handleMoveEnd = () => {
      setCurrentZoom(m.getZoom());
    };

    m.on('moveend', handleMoveEnd);

    return () => {
      m.off('moveend', handleMoveEnd);
    }
  }, [isMapReady]);

  return (
    <div className="relative w-full h-full">
      <div ref={mapContainer} className="w-full h-full" />

      {/* Map Overlay Controls */}
      <div className="absolute top-6 left-6 z-10 w-full max-w-sm pointer-events-none">
        <div className="pointer-events-auto">
          <SearchControl onSelect={handleSearchSelect} />
        </div>
      </div>

      <div className="absolute bottom-8 left-1/2 transform -translate-x-1/2 z-20 flex flex-col items-center gap-4">
        {isMapReady && currentZoom < 13.5 && (
          <button
            onClick={() => map.current?.zoomTo(14)}
            className="bg-slate-800/90 backdrop-blur hover:bg-slate-700 text-white text-xs font-bold py-2 px-4 rounded-full shadow-lg border border-slate-600 transition-all flex items-center gap-2"
          >
            <Map size={14} /> ZOOM TO LEVEL 14
          </button>
        )}

        <button
          onClick={runAnalysis}
          disabled={status !== DataStatus.IDLE && status !== DataStatus.READY && status !== DataStatus.ERROR}
          className={`font-black py-4 px-10 rounded-full shadow-[0_0_20px_rgba(236,72,153,0.5)] border-2 border-white transition-all transform flex items-center gap-3 uppercase tracking-tighter text-lg border-neon-pink
            ${status === DataStatus.PROCESSING || status === DataStatus.FETCHING_MAPILLARY || status === DataStatus.FETCHING_OVERTURE 
              ? 'bg-pink-800 text-pink-300 cursor-not-allowed scale-100' 
              : 'bg-pink-600 hover:bg-pink-500 hover:scale-105 text-white'}`}
        >
          {status === DataStatus.PROCESSING || status === DataStatus.FETCHING_MAPILLARY || status === DataStatus.FETCHING_OVERTURE ? (
             <><span className="animate-spin text-2xl">◌</span> ANALYZING...</>
          ) : (
             <><span className="animate-pulse text-2xl">●</span> SCAN THIS AREA</>
          )}
        </button>
      </div>
    </div>
  );
};