declare module 'sql.js-fts5' {
  export interface SqlValueMap {
    [column: string]: string | number | Uint8Array | null;
  }

  export interface QueryExecResult {
    columns: string[];
    values: Array<Array<string | number | Uint8Array | null>>;
  }

  export interface Statement {
    bind(params?: Array<string | number | Uint8Array | null>): boolean;
    step(): boolean;
    getAsObject(): SqlValueMap;
    get(): Array<string | number | Uint8Array | null>;
    reset(): void;
    freemem(): void;
    free(): boolean;
  }

  export class Database {
    constructor(data?: ArrayLike<number> | Buffer | null);
    run(sql: string, params?: Array<string | number | Uint8Array | null>): Database;
    exec(sql: string, params?: Array<string | number | Uint8Array | null>): QueryExecResult[];
    prepare(sql: string, params?: Array<string | number | Uint8Array | null>): Statement;
    export(): Uint8Array;
    close(): void;
  }

  export interface SqlJsStatic {
    Database: typeof Database;
  }

  export interface InitSqlJsConfig {
    locateFile?: (file: string, prefix?: string) => string;
    wasmBinary?: Uint8Array | ArrayBuffer;
  }

  export default function initSqlJs(config?: InitSqlJsConfig): Promise<SqlJsStatic>;
}
