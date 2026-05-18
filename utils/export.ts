import { FeatureCollection } from 'geojson';

/**
 * Converts a GeoJSON FeatureCollection (containing LineStrings) into a valid GPX v1.1 XML string.
 * @param geojson The GeoJSON FeatureCollection to convert.
 * @param trackName Optional name for the track.
 * @returns A string containing the GPX XML.
 */
export function exportToGPX(geojson: FeatureCollection, trackName: string = 'StreetGap Route'): string {
  let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
  gpx += '<gpx version="1.1" creator="StreetGap" xmlns="http://www.topografix.com/GPX/1/1">\n';
  
  if (geojson && geojson.features) {
    geojson.features.forEach((feature, index) => {
      // OSRM trips are returned as LineStrings
      if (feature.geometry && feature.geometry.type === 'LineString') {
        gpx += '  <trk>\n';
        gpx += `    <name>${trackName} Segment ${index + 1}</name>\n`;
        gpx += '    <trkseg>\n';
        
        const coordinates = feature.geometry.coordinates;
        coordinates.forEach(coord => {
          // GeoJSON is [longitude, latitude]
          const lon = coord[0];
          const lat = coord[1];
          gpx += `      <trkpt lat="${lat}" lon="${lon}"></trkpt>\n`;
        });
        
        gpx += '    </trkseg>\n';
        gpx += '  </trk>\n';
      }
    });
  }
  
  gpx += '</gpx>';
  return gpx;
}
