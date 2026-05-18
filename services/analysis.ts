import { BoundingBox, MapSettings } from '../types';
import { DuckDBService } from './db';
import { OvertureService } from './overture';
import { MapillaryService } from './mapillary';
import { FeatureCollection } from 'geojson';

export interface AnalysisResult {
  undrivenGeoJson: FeatureCollection;
  coverageGeoJson: FeatureCollection;
  stats: {
    coveragePointsProcessed: number;
    undrivenSegmentsCount: number;
    queryTimeMs: number;
  };
}

export class AnalysisService {
  /**
   * Orchestrates fetching data from Overture and Mapillary,
   * running the spatial difference query in DuckDB, 
   * and extracting the GeoJSON results for rendering.
   */
  public static async runCoverageAnalysis(
    bbox: BoundingBox, 
    settings: MapSettings,
    coverageGeoJson: FeatureCollection,
    onStatusChange: (status: string) => void
  ): Promise<AnalysisResult> {
    const db = DuckDBService.getInstance();
    
    // 1. Fetch Roads
    onStatusChange('FETCHING_OVERTURE');
    await OvertureService.fetchRoads(bbox);

    // 2. Load Extracted Coverage
    onStatusChange('PROCESSING'); // Renamed step to PROCESSING since we no longer fetch
    await MapillaryService.loadVectorCoverage(coverageGeoJson);

    // 3. Process Differences
    onStatusChange('PROCESSING');
    const conn = await db.getConnection();
    const startAnalysis = performance.now();

    // Create result table
    await conn.query(`
      CREATE OR REPLACE TABLE undriven_roads AS
      SELECT 
          r.id,
          r.geometry,
          r.class
      FROM raw_roads r
      WHERE NOT EXISTS (
          SELECT 1 
          FROM coverage c 
          WHERE ST_DWithin(r.geometry, c.geometry, ${settings.bufferSize / 111000})
      )
    `);

    // 4. Extract Undriven Roads for Render
    const undrivenResult = await conn.query(`
      SELECT ST_AsGeoJSON(geometry) as geom_json, class FROM undriven_roads
    `);

    const undrivenFeatures: any[] = [];
    const undrivenNumRows = undrivenResult.numRows;
    const undrivenGeomCol = undrivenResult.getChild('geom_json');
    const undrivenClassCol = undrivenResult.getChild('class');

    if (undrivenGeomCol && undrivenClassCol) {
      for (let i = 0; i < undrivenNumRows; i++) {
        const rawJson = undrivenGeomCol.get(i);
        const roadClass = undrivenClassCol.get(i);
        if (rawJson) {
          undrivenFeatures.push({
            type: "Feature",
            geometry: JSON.parse(rawJson),
            properties: { status: "undriven", class: roadClass }
          });
        }
      }
    }

    const undrivenGeoJson: FeatureCollection = {
      type: "FeatureCollection",
      features: undrivenFeatures
    };

    const endAnalysis = performance.now();

    // Stats
    const countResult = await conn.query(`SELECT count(*) as c FROM undriven_roads`);
    const count = Number(countResult.toArray()[0]['c']);

    // Count coverage features just for stats logging
    const covCountResult = await conn.query(`SELECT count(*) as c FROM coverage`);
    const covCount = Number(covCountResult.toArray()[0]['c']);

    console.log(`AnalysisService: Analysis complete. Processed ${covCount} coverage geometries and ${count} undriven segments.`);

    return {
      undrivenGeoJson,
      coverageGeoJson: { type: "FeatureCollection", features: [] },
      stats: {
        coveragePointsProcessed: covCount,
        undrivenSegmentsCount: count,
        queryTimeMs: Math.round(endAnalysis - startAnalysis)
      }
    };
  }
}
