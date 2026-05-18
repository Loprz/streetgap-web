export interface BoundingBox {
  minLon: number;
  minLat: number;
  maxLon: number;
  maxLat: number;
}

export interface ProcessingStats {
  loadedSegments: number;
  processedCoverage: number;
  undrivenSegments: number;
  queryTimeMs: number;
}

export interface MapSettings {
  lookbackYears: number; // Number of years to look back for coverage
  bufferSize: number; // Meters
  showCoverage: boolean;
  showUndriven: boolean;
  showRoute: boolean;
  mapillaryToken: string;
  roadFilters: {
    residential: boolean;
    main: boolean;
    living: boolean;
    pedestrian: boolean;
    service: boolean;
  };
}

export enum DataStatus {
  IDLE = 'IDLE',
  LOADING_WASM = 'LOADING_WASM',
  FETCHING_OVERTURE = 'FETCHING_OVERTURE',
  FETCHING_MAPILLARY = 'FETCHING_MAPILLARY',
  PROCESSING = 'PROCESSING',
  READY = 'READY',
  ERROR = 'ERROR'
}
