import React, { useEffect, useRef, useState, useCallback } from 'react';
import maplibregl from 'maplibre-gl';
import { BoundingBox, DataStatus, MapSettings, ProcessingStats } from '../types';
import { DuckDBService } from '../services/db';
import { OvertureService } from '../services/overture';
import { MapillaryService } from '../services/mapillary';
import { Map, Navigation } from 'lucide-react';
import * as arrow from 'apache-arrow';
import { SearchControl } from './SearchControl';

interface Props {
  settings: MapSettings;
  onStatusChange: (status: DataStatus) => void;
  onStatsChange: (stats: ProcessingStats) => void;
}

export const StreetGapMap: React.FC<Props> = ({ settings, onStatusChange, onStatsChange }) => {
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

      map.current.on('error', (e) => {
        console.error("StreetGapMap: Map error", e);
      });
    } catch (err) {
      console.error("StreetGapMap: Error during initialization", err);
    }

    // Cleanup
    return () => {
      map.current?.remove();
      map.current = null;
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
      const db = DuckDBService.getInstance();

      // 1. Fetch Roads
      onStatusChange(DataStatus.FETCHING_OVERTURE);
      await OvertureService.fetchRoads(bbox);

      // 2. Fetch Coverage
      onStatusChange(DataStatus.FETCHING_MAPILLARY);
      const minDate = new Date();
      minDate.setFullYear(minDate.getFullYear() - settings.lookbackYears);

      await MapillaryService.fetchCoverage(bbox, settings.mapillaryToken, minDate.toISOString());

      // 3. Process Differences
      onStatusChange(DataStatus.PROCESSING);
      const conn = await db.getConnection();

      const startAnalysis = performance.now();

      // Find roads that are NOT within 20 meters of any coverage point
      // Note: Full ST_Difference is heavy, we use ST_DWithin check for performance in Wasm
      // Ideally we would buffer the coverage points and subtract, but checking distance is faster for "undriven" classification
      // "LEFT JOIN ... WHERE coverage.geom IS NULL" logic

      // Create result table
      await conn.query(`
        CREATE OR REPLACE TABLE undriven_roads AS
        SELECT 
            r.id,
            r.geometry
        FROM raw_roads r
        WHERE NOT EXISTS (
            SELECT 1 
            FROM coverage c 
            WHERE ST_DWithin(r.geometry, c.geometry, ${settings.bufferSize / 111000}) -- Approx degrees conversion
        )
      `);

      // 4. Extract for Render
      // Get GeoJSON from DuckDB
      // We convert geometry to WKT or use ST_AsGeoJSON if available
      const result = await conn.query(`
        SELECT ST_AsGeoJSON(geometry) as geom_json FROM undriven_roads
      `);

      const features: any[] = [];
      // Iterate Arrow Table
      const numRows = result.numRows;
      const geomCol = result.getChild('geom_json');

      if (geomCol) {
        for (let i = 0; i < numRows; i++) {
          const rawJson = geomCol.get(i);
          if (rawJson) {
            features.push({
              type: "Feature",
              geometry: JSON.parse(rawJson),
              properties: { status: "undriven" }
            });
          }
        }
      }

      const geoJsonData = {
        type: "FeatureCollection" as const,
        features: features
      };

      // 5. Update Coverage Layer
      const coverageResult = await conn.query(`SELECT ST_AsGeoJSON(geometry) as geom_json FROM coverage`);
      const coverageFeatures: any[] = [];
      const covNumRows = coverageResult.numRows;
      const covGeomCol = coverageResult.getChild('geom_json');

      if (covGeomCol) {
        for (let i = 0; i < covNumRows; i++) {
          const rawJson = covGeomCol.get(i);
          if (rawJson) {
            coverageFeatures.push({
              type: "Feature",
              geometry: JSON.parse(rawJson),
              properties: {}
            });
          }
        }
      }

      const coverageGeoJson = {
        type: "FeatureCollection" as const,
        features: coverageFeatures
      };

      if (map.current.getSource('coverage-source')) {
        (map.current.getSource('coverage-source') as maplibregl.GeoJSONSource).setData(coverageGeoJson);
        // Explicitly sync visibility when data updates
        if (map.current.getLayer('coverage-layer')) {
          map.current.setLayoutProperty('coverage-layer', 'visibility', settings.showCoverage ? 'visible' : 'none');
        }
      } else {
        map.current.addSource('coverage-source', {
          type: 'geojson',
          data: coverageGeoJson
        });
        map.current.addLayer({
          id: 'coverage-layer',
          type: 'circle',
          source: 'coverage-source',
          paint: {
            'circle-color': '#facc15', // Neon Yellow
            'circle-radius': 4,
            'circle-opacity': 0.8,
            'circle-stroke-width': 1,
            'circle-stroke-color': '#000'
          },
          layout: {
            'visibility': settings.showCoverage ? 'visible' : 'none'
          }
        });
      }

      console.log(`StreetGapMap: Analysis complete. Found ${coverageFeatures.length} coverage points and ${count} undriven segments.`);

      // 6. Update Undriven Layer
      if (map.current.getSource('undriven-source')) {
        (map.current.getSource('undriven-source') as maplibregl.GeoJSONSource).setData(geoJsonData);
      } else {
        map.current.addSource('undriven-source', {
          type: 'geojson',
          data: geoJsonData
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
            'line-color': '#FF00FF', // Neon Pink
            'line-width': 4,
            'line-opacity': 0.8
          }
        });
      }

      const endAnalysis = performance.now();

      // Update Stats
      const countResult = await conn.query(`SELECT count(*) as c FROM undriven_roads`);
      const count = Number(countResult.toArray()[0]['c']); // Simple access

      onStatsChange({
        loadedSegments: 0, // Todo: count raw_roads
        processedCoverage: coverageFeatures.length,
        undrivenSegments: count,
        queryTimeMs: Math.round(endAnalysis - startAnalysis)
      });

      onStatusChange(DataStatus.READY);

    } catch (e) {
      console.error("Analysis Failed", e);
      onStatusChange(DataStatus.ERROR);
    }
  }, [settings, onStatusChange, onStatsChange]);

  const fetchRoute = useCallback(async (points: [number, number][]) => {
    if (points.length < 2) return;

    try {
      const coords = points.map(p => `${p[0]},${p[1]}`).join(';');
      const response = await fetch(`https://router.project-osrm.org/route/v1/driving/${coords}?geometries=geojson&overview=full`);
      const data = await response.json();

      if (data.code === 'Ok' && data.routes.length > 0) {
        const route = data.routes[0].geometry;
        if (map.current) {
          (map.current.getSource('route-source') as maplibregl.GeoJSONSource).setData({
            type: 'FeatureCollection',
            features: [{
              type: 'Feature',
              properties: {},
              geometry: route
            }]
          });
        }
      }
    } catch (err) {
      console.error("Routing error:", err);
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

  // Handle Coverage Visibility
  useEffect(() => {
    if (!isMapReady || !map.current) return;
    const m = map.current;
    if (m.getLayer('coverage-layer')) {
      const visibility = settings.showCoverage ? 'visible' : 'none';
      console.log(`StreetGapMap: Toggling coverage visibility to ${visibility}`);
      m.setLayoutProperty('coverage-layer', 'visibility', visibility);
    }
  }, [isMapReady, settings.showCoverage]);

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
          className="bg-pink-600 hover:bg-pink-500 text-white font-black py-4 px-10 rounded-full shadow-[0_0_20px_rgba(236,72,153,0.5)] border-2 border-white transition-all transform hover:scale-105 flex items-center gap-3 uppercase tracking-tighter text-lg border-neon-pink"
        >
          <span className="animate-pulse text-2xl">●</span> SCAN THIS AREA
        </button>
      </div>
    </div>
  );
};