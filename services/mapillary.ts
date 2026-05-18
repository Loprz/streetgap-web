import { BoundingBox } from '../types';
import { DuckDBService } from './db';
import { FeatureCollection } from 'geojson';

export class MapillaryService {
    public static async loadVectorCoverage(coverageData: FeatureCollection): Promise<void> {
        const db = DuckDBService.getInstance();
        const conn = await db.getConnection();

        // Drop and recreate coverage table
        await conn.query(`CREATE OR REPLACE TABLE coverage (geometry GEOMETRY)`);

        if (!coverageData || !coverageData.features || coverageData.features.length === 0) {
            console.log("No Mapillary data provided for this area.");
            return;
        }

        const features = coverageData.features;
        
        // We will bulk insert these GeoJSON features into DuckDB
        // ST_GeomFromGeoJSON expects a stringified GeoJSON geometry object.
        const CHUNK_SIZE = 500;
        for (let i = 0; i < features.length; i += CHUNK_SIZE) {
            const chunk = features.slice(i, i + CHUNK_SIZE);
            const insertValues = chunk
                .map((f: any) => {
                    const geometryJson = JSON.stringify(f.geometry).replace(/'/g, "''"); // escape single quotes for SQL
                    return `(ST_GeomFromGeoJSON('${geometryJson}'))`;
                }).join(',');

            if (insertValues.length > 0) {
                await conn.query(`INSERT INTO coverage VALUES ${insertValues}`);
            }
        }

        console.log(`MapillaryService: Loaded ${features.length} vector coverage LineStrings into DuckDB.`);
    }
}
