import * as lancedb from '@lancedb/lancedb';
import * as vscode from 'vscode';
import * as arrow from 'apache-arrow';

export interface VectorRow {
    vector: number[];
    text: string;
    filePath: string;
    startLine: number;
    endLine: number;
    type: string;
    symbol: string;
    parentSymbol: string;
}

function getSchema(dimension: number): arrow.Schema {
    return new arrow.Schema([
        new arrow.Field('vector', new arrow.FixedSizeList(dimension, new arrow.Field('item', new arrow.Float32()))),
        new arrow.Field('text', new arrow.Utf8()),
        new arrow.Field('filePath', new arrow.Utf8()),
        new arrow.Field('startLine', new arrow.Int32()),
        new arrow.Field('endLine', new arrow.Int32()),
        new arrow.Field('type', new arrow.Utf8()),
        new arrow.Field('symbol', new arrow.Utf8()),
        new arrow.Field('parentSymbol', new arrow.Utf8())
    ]);
}

export class VectorDB {

    private constructor(private readonly dimension: number, 
        private readonly connection: lancedb.Connection, 
        private table: lancedb.Table,
        private reranker: lancedb.rerankers.RRFReranker
    ) {

    }

    static async create(context: vscode.ExtensionContext, dimension: number | undefined = undefined): Promise<VectorDB> {
        if (!context.storageUri) throw new Error("Cannot initialze VectorDB: No active workspace");

        const dbUri = vscode.Uri.joinPath(context.storageUri, 'vector-db');
        await vscode.workspace.fs.createDirectory(dbUri);
        const dbPath = dbUri.fsPath;

        const connection = await lancedb.connect(dbPath);
        
        const tableName = 'workspace_chunks';
        const tableNames = await connection.tableNames();
        // console.log(`Current tables in workspace: ${tableNames}`);
        const tableExists = tableNames.includes(tableName);
        
        let table: lancedb.Table;

        const reranker = await lancedb.rerankers.RRFReranker.create();
        
        // Open existing table
        if (dimension === undefined && tableExists) {

            table = await connection.openTable(tableName);
            const rows = await table.query().limit(1).toArray();

            if (rows.length > 0) {
                const existingDimension = rows[0].vector.length;
                return new VectorDB(existingDimension, connection, table, reranker);
            }
        }

        // Create new table, if we pass in a defined dimension we are making a new table
        if (dimension === undefined) throw new Error("Workspace has not been indexed yet.");
        if (tableExists) await connection.dropTable(tableName);

        const schema = getSchema(dimension);

        table = await connection.createTable(tableName, [], { schema: schema});
        await table.createIndex('text', { config: lancedb.Index.fts() });

        return new VectorDB(dimension, connection, table, reranker);
    }

    public async insertRows(rows: VectorRow[]): Promise<void> {
        if (rows.length === 0) return;

        await this.table.add(rows as unknown as Record<string, unknown>[]);
    }

    public async deleteByFilePath(filePath: string): Promise<void> {
        await this.table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
    }

    public async hybridSearch(queryText: string, queryVector: number[], limit: number): Promise<any[]> {

        const results = await this.table
            .query()
            .fullTextSearch(queryText)
            .nearestTo(queryVector)
            .rerank(this.reranker)
            .limit(limit)
            .toArray();

        return results;

        // const results = await this.table.search(queryVector).limit(limit).toArray();

        // return results.filter(row => row.filePath !== "system");
    }

    public async clearAll(): Promise<void> {

        const schema = getSchema(this.dimension);

        this.table = await this.connection.createTable(
            'workspace_chunks',
            [],
            { schema: schema, mode: 'overwrite' }
        );

        await this.table.createIndex('text', { config: lancedb.Index.fts() });
    }

    public async getRowsByFilePath(filePath: string): Promise<VectorRow[]> {
        return await this.table
            .query()
            .where(`filePath = '${filePath.replace(/'/g, "''")}'`)
            .toArray() as unknown as VectorRow[];
    }

    public async getFilePathByImport(importName: string): Promise<any[]>  {
        const result = await this.table
            .query()
            .fullTextSearch(importName)
            .select(['filePath'])
            .toArray();

        return result;
    }
}
