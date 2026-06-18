import * as lancedb from '@lancedb/lancedb';
import * as vscode from 'vscode';

export interface VectorRow {
    vector: number[];
    text: string;
    filePath: string;
    startLine: number;
    endLine: number;
    type: string;
}

export class VectorDB {

    private constructor(private readonly dimension: number, 
                        private readonly connection: lancedb.Connection, 
                        private table: lancedb.Table
    ) {}

    static async create(context: vscode.ExtensionContext, dimension: number | undefined = undefined): Promise<VectorDB> {
        if (!context.storageUri) throw new Error("Cannot initialze VectorDB: No active workspace");

        const dbUri = vscode.Uri.joinPath(context.storageUri, 'vector-db');
        await vscode.workspace.fs.createDirectory(dbUri);
        const dbPath = dbUri.fsPath;

        const connection = await lancedb.connect(dbPath);
        
        const tableName = 'workspace_chunks';
        const tableNames = await connection.tableNames();
        console.log(`Current tables in workspace: ${tableNames}`);
        const tableExists = tableNames.includes(tableName);
        
        let table: lancedb.Table;
        
        // Open existing table
        if (dimension === undefined && tableExists) {

            table = await connection.openTable(tableName);
            const rows = await table.query().limit(1).toArray();

            if (rows.length > 0) {
                const existingDimension = rows[0].vector.length;
                return new VectorDB(existingDimension, connection, table);
            }
        }

        // Create new table, if we pass in a defined dimension we are making a new table
        if (dimension === undefined) throw new Error("Workspace has not been indexed yet.");
        if (tableExists) await connection.dropTable(tableName);

        const initialSchema: Record<string, unknown>[] = [
            {
                vector: Array(dimension).fill(0),
                text: "__INITIAL_SCHEMA__",
                filePath: "system",
                startLine: 0,
                endLine: 0,
                type: "system"
            }
        ];

        table = await connection.createTable(tableName, initialSchema);

        return new VectorDB(dimension, connection, table);
    }

    public async insertRows(rows: VectorRow[]): Promise<void> {
        if (rows.length === 0) return;

        await this.table.add(rows as unknown as Record<string, unknown>[]);
    }

    public async deleteByFilePath(filePath: string): Promise<void> {
        await this.table.delete(`filePath = '${filePath.replace(/'/g, "''")}'`);
    }

    public async vectorSearch(queryVector: number[], limit: number): Promise<any[]> {
        const results = await this.table.search(queryVector).limit(limit).toArray();

        return results.filter(row => row.filePath !== "system");
    }

    public async clearAll(): Promise<void> {
        const initialSchema: Record<string, unknown>[] = [
            {
                vector: Array(this.dimension).fill(0),
                text: "__INITIAL_SCHEMA__",
                filePath: "system",
                startLine: 0,
                endLine: 0,
                type: "system",
            }
        ];

        this.table = await this.connection.createTable(
            'workspace_chunks',
            initialSchema,
            { mode: 'overwrite' }
        );
    }

    public async getRowsByFilePath(filePath: string): Promise<VectorRow[]> {
        return await this.table
            .query()
            .where(`filePath = '${filePath.replace(/'/g, "''")}'`)
            .toArray() as unknown as VectorRow[];
    }
}
