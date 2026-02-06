import { BoundingBox } from '../types';
import { DuckDBService } from './db';

export class MapillaryService {
    /**
     * Since we cannot easily decode Vector Tiles (PBF) without heavy libraries in this environment,
     * we will use the Mapillary API v4 'images' endpoint to get points, which serves as a proxy for coverage.
     * In a full production app, we would use the Vector Tile 'sequences' or 'computed_public' layer.
     */
    public static async fetchCoverage(bbox: BoundingBox, token: string, minDate: string): Promise<void> {
        const db = DuckDBService.getInstance();
        const conn = await db.getConnection();

        if (!token) {
            // Create empty table to prevent join errors
            await conn.query(`CREATE OR REPLACE TABLE coverage (geometry GEOMETRY, captured_at BIGINT)`);
            return;
        }

        // Fetch images (points) within BBOX
        const encodedToken = encodeURIComponent(token);
        const url = `https://graph.mapillary.com/images?access_token=${encodedToken}&fields=id,geometry,captured_at&bbox=${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}&limit=1000`;

        try {
            const response = await fetch(url);

            if (!response.ok) {
                const errorText = await response.text();
                console.error(`Mapillary API Error (${response.status}): ${errorText}`);
                // Create empty table to prevent join errors
                await conn.query(`CREATE OR REPLACE TABLE coverage (geometry GEOMETRY, captured_at BIGINT)`);
                return;
            }

            const data = await response.json();

            if (!data.data || data.data.length === 0) {
                console.warn("No Mapillary data found for this area.");
                // Create empty table to prevent join errors
                await conn.query(`CREATE OR REPLACE TABLE coverage (geometry GEOMETRY, captured_at BIGINT)`);
                return;
            }

            const coverageFeatures = data.data.map((img: any) => ({
                type: "Feature",
                geometry: img.geometry,
                properties: {
                    captured_at: img.captured_at
                }
            }));

            // Create table once
            await conn.query(`CREATE OR REPLACE TABLE coverage (geometry GEOMETRY, captured_at BIGINT)`);

            // Bulk insert builder
            const insertValues = coverageFeatures
                .filter((f: any) => {
                    const ts = f.properties.captured_at;
                    return ts > new Date(minDate).getTime();
                })
                .map((f: any) => {
                    const lon = f.geometry.coordinates[0];
                    const lat = f.geometry.coordinates[1];
                    return `(ST_Point(${lon}, ${lat}), ${f.properties.captured_at})`;
                }).join(',');

            if (insertValues.length > 0) {
                await conn.query(`INSERT INTO coverage VALUES ${insertValues}`);
            }

            console.log(`MapillaryService: Loaded ${coverageFeatures.length} points into DuckDB (Filtered down to ${insertValues.split('),').length} by date).`);

        } catch (e) {
            console.error("Error fetching Mapillary data", e);
            throw e;
        }
    }
}
