import * as duckdb from '@duckdb/duckdb-wasm';

const JSDELIVR_BUNDLES = duckdb.getJsDelivrBundles();

export class DuckDBService {
  private static instance: DuckDBService;
  private db: duckdb.AsyncDuckDB | null = null;
  private conn: duckdb.AsyncDuckDBConnection | null = null;
  private isInitializing: boolean = false;

  private constructor() { }

  public static getInstance(): DuckDBService {
    if (!DuckDBService.instance) {
      DuckDBService.instance = new DuckDBService();
    }
    return DuckDBService.instance;
  }

  public async init(): Promise<void> {
    if (this.db) return;
    if (this.isInitializing) {
      while (this.isInitializing) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
      return;
    }

    this.isInitializing = true;

    try {
      const bundle = await duckdb.selectBundle(JSDELIVR_BUNDLES);

      const worker = await duckdb.createWorker(bundle.mainWorker!);
      const logger = new duckdb.ConsoleLogger();

      this.db = new duckdb.AsyncDuckDB(logger, worker);
      await this.db.instantiate(bundle.mainModule, bundle.pthreadWorker);

      this.conn = await this.db.connect();

      // Explicitly load spatial extension.
      // Note: In some environments, auto-install fails. We attempt both install+load and direct load.
      try {
        await this.conn.query(`INSTALL spatial; LOAD spatial;`);
      } catch (e) {
        console.warn("Standard spatial install failed. Trying direct load...", e);
        try {
          await this.conn.query(`LOAD spatial;`);
        } catch (e2) {
          console.error("Could not load spatial extension. Spatial queries will fail.", e2);
          // We do not throw here to allow the app to render basic UI even if spatial fails
        }
      }

      // Configure HTTPFS / S3
      // We wrap this in try-catch as well to be safe
      try {
        await this.conn.query(`
          SET s3_region='us-west-2';
          SET s3_access_key_id='';
          SET s3_secret_access_key='';
        `);
      } catch (e3) {
        console.warn("Failed to configure S3 access", e3);
      }

      console.log('DuckDB initialized');
    } catch (e) {
      console.error('Failed to initialize DuckDB', e);
      throw e;
    } finally {
      this.isInitializing = false;
    }
  }

  public async getConnection(): Promise<duckdb.AsyncDuckDBConnection> {
    if (!this.conn) {
      await this.init();
    }
    if (!this.conn) throw new Error("Database connection failed");
    return this.conn;
  }

  public async runQuery(sql: string): Promise<any> {
    const conn = await this.getConnection();
    return await conn.query(sql);
  }
}