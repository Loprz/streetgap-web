import { BoundingBox } from '../types';
import { DuckDBService } from './db';

const STAC_ROOT_URL = 'https://stac.overturemaps.org';

export class OvertureService {
  private static latestRelease: string | null = null;

  /**
   * Dynamically find the latest Overture release version from the STAC root.
   */
  private static async getLatestRelease(): Promise<string> {
    if (this.latestRelease) return this.latestRelease;
    try {
      const response = await fetch(`${STAC_ROOT_URL}/catalog.json`);
      const data = await response.json();
      this.latestRelease = data.latest || '2026-01-21.0';
    } catch (e) {
      console.warn("Failed to fetch latest Overture release, using fallback.", e);
      this.latestRelease = '2026-01-21.0';
    }
    return this.latestRelease!;
  }

  /**
   * 1. Query STAC for the latest release version.
   * 2. Traverse the STAC catalog to find parquet file assets.
   * 3. Use DuckDB to load those files and filter precisely to the BBOX.
   */
  public static async fetchRoads(bbox: BoundingBox): Promise<void> {
    const db = DuckDBService.getInstance();
    const conn = await db.getConnection();

    // 1. Get latest release version
    const latest = await this.getLatestRelease();

    // 2. Fetch the transportation segment collection
    const collectionUrl = `${STAC_ROOT_URL}/${latest}/transportation/segment/collection.json`;
    console.log(`Matching Overture partitions for BBOX from ${collectionUrl}...`);
    const collResp = await fetch(collectionUrl);
    if (!collResp.ok) throw new Error(`Overture collection not found: ${collResp.status}`);
    const collectionData = await collResp.json();

    // 3. Find items that overlap our BBOX
    // In a static STAC, the items themselves describe their BBOX.
    const itemLinks = (collectionData.links || []).filter((l: any) => l.rel === 'item');

    // Fetch item details to get BBOXes and Assets
    // Note: We use the absolute URL by resolving against the collection URL
    const itemUrls = itemLinks.map((l: any) => new URL(l.href, collectionUrl).toString());

    // We fetch them in parallel. Overture usually has ~60 partitions for segments.
    const itemDetails = await Promise.all(itemUrls.map(async (url: string) => {
      const resp = await fetch(url);
      return resp.json();
    }));

    // 4. Filter items by BBOX
    const overlappingFiles = itemDetails
      .filter((item: any) => {
        if (!item.bbox) return true; // Safety
        const [minX, minY, maxX, maxY] = item.bbox;
        // Intersection check: Rect A (minX, minY, maxX, maxY) vs Rect B (bbox)
        return !(maxX < bbox.minLon || minX > bbox.maxLon || maxY < bbox.minLat || minY > bbox.maxLat);
      })
      .map((item: any) => item.assets?.['aws-https']?.href || item.assets?.['azure-https']?.href)
      .filter(Boolean);

    if (overlappingFiles.length === 0) {
      console.warn("No overlapping Overture partitions found for this BBOX.");
      // Create empty table to avoid query failures
      await conn.query(`CREATE OR REPLACE TABLE raw_roads (id VARCHAR, geometry GEOMETRY, subtype VARCHAR, class VARCHAR)`);
      return;
    }

    console.log(`Loading Overture data from ${overlappingFiles.length} partitions...`);
    const fileListSql = overlappingFiles.map((u: string) => `'${u}'`).join(', ');

    // 5. Query the Parquet files via DuckDB
    await conn.query(`
      CREATE OR REPLACE TABLE raw_roads AS 
      SELECT 
        id,
        geometry,
        subtype,
        class
      FROM read_parquet([${fileListSql}])
      WHERE 
        bbox.xmin >= ${bbox.minLon} AND
        bbox.ymin >= ${bbox.minLat} AND
        bbox.xmax <= ${bbox.maxLon} AND
        bbox.ymax <= ${bbox.maxLat}
        AND subtype = 'road'
    `);
  }
}
