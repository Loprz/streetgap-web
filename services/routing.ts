import { FeatureCollection } from 'geojson';

// In dev, Vite proxies /api/osrm → https://router.project-osrm.org to avoid CORS.
// In production, swap this for your own OSRM instance or a server-side proxy.
const OSRM_BASE = '/api/osrm';

export class RoutingService {
  /**
   * Fetches an OSRM driving route for the given list of coordinates.
   * Modifies the provided GeoJSON source in MAPLibre directly, or returns the GeoJSON.
   *
   * @param points - Array of [longitude, latitude] pairs.
   * @returns A GeoJSON FeatureCollection representing the route, or null if it fails.
   */
  public static async fetchRoute(points: [number, number][]): Promise<FeatureCollection | null> {
    if (points.length < 2) return null;

    try {
      // Constructing OSRM query
      // radiuses=unlimited allows it to snap to the nearest road even if our point isn't exactly on one.
      const radiuses = points.map(() => 'unlimited').join(';');
      const coords = points.map(p => `${p[0]},${p[1]}`).join(';');
      const response = await fetch(`${OSRM_BASE}/route/v1/driving/${coords}?geometries=geojson&overview=full&radiuses=${radiuses}`);
      if (!response.ok) {
        console.warn(`Route request failed with status ${response.status}`);
        return null;
      }
      const data = await response.json();

      if (data.code === 'Ok' && data.routes.length > 0) {
        return {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: data.routes[0].geometry
          }]
        };
      } else {
        // Fallback to straight line routing if OSRM fails
        return {
          type: 'FeatureCollection',
          features: [{
            type: 'Feature',
            properties: {},
            geometry: {
              type: 'LineString',
              coordinates: points
            }
          }]
        };
      }
    } catch (err) {
      console.error("Routing error:", err);
      return null;
    }
  }

  /**
   * Sorts all points into a spatially-coherent sequence using greedy
   * Nearest-Neighbor starting from the geographic centroid.
   */
  private static sortByNearestNeighbor(points: [number, number][]): [number, number][] {
    if (points.length <= 1) return [...points];

    const unvisited = [...points];
    
    // Find the geographic centroid as the starting point
    let cLng = 0, cLat = 0;
    for (const p of unvisited) { cLng += p[0]; cLat += p[1]; }
    cLng /= unvisited.length;
    cLat /= unvisited.length;

    // Find the point closest to the centroid to start from
    let startIdx = 0;
    let minStartDist = Infinity;
    for (let i = 0; i < unvisited.length; i++) {
      const d = (unvisited[i][0] - cLng) ** 2 + (unvisited[i][1] - cLat) ** 2;
      if (d < minStartDist) { minStartDist = d; startIdx = i; }
    }

    let current = unvisited.splice(startIdx, 1)[0];
    const sorted: [number, number][] = [current];

    while (unvisited.length > 0) {
      let nearestIdx = 0;
      let minDist = Infinity;
      for (let i = 0; i < unvisited.length; i++) {
        const d = (unvisited[i][0] - current[0]) ** 2 + (unvisited[i][1] - current[1]) ** 2;
        if (d < minDist) { minDist = d; nearestIdx = i; }
      }
      current = unvisited.splice(nearestIdx, 1)[0];
      sorted.push(current);
    }

    return sorted;
  }

  /**
   * Calls OSRM /trip/ for a single chunk of points.
   * Returns the trip geometry coordinates array, or null on failure.
   */
  private static async fetchTripChunk(
    points: [number, number][],
    mode: 'driving' | 'foot'
  ): Promise<[number, number][] | null> {
    if (points.length < 2) return null;
    const radiuses = points.map(() => 'unlimited').join(';');
    const coordsString = points.map(p => `${p[0]},${p[1]}`).join(';');

    try {
      // Use source=first so the trip starts at the first point in the chunk (our NN-sorted order)
      // and roundtrip=false so it doesn't loop back to the start.
      const response = await fetch(
        `${OSRM_BASE}/trip/v1/${mode}/${coordsString}?geometries=geojson&overview=full&radiuses=${radiuses}&source=first&roundtrip=false`
      );
      if (!response.ok) {
        console.warn(`Trip chunk failed with status ${response.status}`);
        return null;
      }
      const data = await response.json();

      if (data.code === 'Ok' && data.trips && data.trips.length > 0) {
        return data.trips[0].geometry.coordinates as [number, number][];
      }
      console.warn('Trip chunk failed:', data);
      return null;
    } catch (err) {
      console.error('Trip chunk error:', err);
      return null;
    }
  }

  /**
   * Calls OSRM /route/ to get a connecting path between two points.
   * Returns the route geometry coordinates, or a straight-line fallback.
   */
  private static async fetchConnector(
    from: [number, number],
    to: [number, number],
    mode: 'driving' | 'foot'
  ): Promise<[number, number][]> {
    try {
      const coords = `${from[0]},${from[1]};${to[0]},${to[1]}`;
      const response = await fetch(
        `${OSRM_BASE}/route/v1/${mode}/${coords}?geometries=geojson&overview=full&radiuses=unlimited;unlimited`
      );
      if (!response.ok) return [from, to];
      const data = await response.json();
      if (data.code === 'Ok' && data.routes && data.routes.length > 0) {
        return data.routes[0].geometry.coordinates as [number, number][];
      }
    } catch (_) { /* fall through to straight line */ }
    return [from, to];
  }

  /**
   * Multi-Chunk Trip Stitching: generates a route that covers ALL provided
   * features by splitting them into OSRM-compatible chunks, routing each
   * chunk, then stitching them together with connector routes.
   */
  public static async generateTrip(
    features: any[],
    mode: 'driving' | 'foot'
  ): Promise<FeatureCollection | null> {
    if (!features || features.length === 0) return null;

    try {
      // 1. Extract a representative point for each road segment
      let points: [number, number][] = features.map(f => {
        const coords = f.geometry.coordinates;
        if (f.geometry.type === 'LineString' && coords.length > 0) {
          return coords[Math.floor(coords.length / 2)] as [number, number];
        }
        return coords[0] as [number, number];
      }).filter(p => p && p.length >= 2);

      if (points.length < 2) return null;

      // 2. Sort ALL points into a spatially-coherent sequence
      const sorted = this.sortByNearestNeighbor(points);

      // 3. Chunk the sorted array into batches of CHUNK_SIZE
      // OSRM demo server times out with large trip requests; 25 is reliable
      const CHUNK_SIZE = 25;
      const chunks: [number, number][][] = [];
      for (let i = 0; i < sorted.length; i += CHUNK_SIZE) {
        chunks.push(sorted.slice(i, i + CHUNK_SIZE));
      }

      console.log(`[Routing] Generating multi-chunk route: ${sorted.length} points → ${chunks.length} chunk(s)`);

      // 4. Process each chunk sequentially and stitch them together
      const allCoordinates: [number, number][] = [];

      for (let c = 0; c < chunks.length; c++) {
        const chunk = chunks[c];

        // If a chunk has only 1 point, skip the trip call but remember it for stitching
        if (chunk.length < 2) {
          if (allCoordinates.length > 0) {
            const connector = await this.fetchConnector(
              allCoordinates[allCoordinates.length - 1],
              chunk[0],
              mode
            );
            allCoordinates.push(...connector);
          }
          allCoordinates.push(chunk[0]);
          continue;
        }

        // If this isn't the first chunk, stitch from previous chunk's last coord
        // to this chunk's first point via /route/
        if (c > 0 && allCoordinates.length > 0) {
          const lastCoord = allCoordinates[allCoordinates.length - 1];
          const connector = await this.fetchConnector(lastCoord, chunk[0], mode);
          allCoordinates.push(...connector);
        }

        // Run OSRM /trip/ for this chunk
        const tripCoords = await this.fetchTripChunk(chunk, mode);
        if (tripCoords) {
          allCoordinates.push(...tripCoords);
        } else {
          // Fallback: just add the raw points as a straight-line path
          allCoordinates.push(...chunk);
        }
      }

      if (allCoordinates.length < 2) return null;

      return {
        type: 'FeatureCollection',
        features: [
          {
            type: 'Feature',
            properties: { mode, chunks: chunks.length, totalPoints: sorted.length },
            geometry: {
              type: 'LineString',
              coordinates: allCoordinates
            }
          }
        ]
      };
    } catch (err) {
      console.error("Multi-chunk trip error:", err);
      return null;
    }
  }
}
