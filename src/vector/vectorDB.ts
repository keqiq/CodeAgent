import * as lancedb from '@lancedb/lancedb';
import * as vscode from 'vscode';

export class VectorDB{
    private connection: lancedb.Connection;
    private table: lancedb.Table;
    private readonly tableName = 'workspace_chunks';

    constructor(connection: lancedb.Connection, table: lancedb.Table) {
        this.connection = connection;
        this.table = table;
    }

    static async create(context: vscode.ExtensionContext): Promise<VectorDB> {
        if (!context.storageUri) throw new Error("Cannot initialze VectorDB: No active workspace");

        await vscode.workspace.fs.createDirectory(context.storageUri);
        const dbPath = context.storageUri.fsPath;

        const connection = await lancedb.connect(dbPath);
        let table: lancedb.Table;
        const tableName = 'workspace_chunks';

        const tableNames = await connection.tableNames();

        // open existing table
        if (tableNames.includes(tableName)) table = await connection.openTable(tableName);

        // create new table
        else {
            const initialSchema = [
                { vector: Array(1536).fill(0), text: "__INITIAL_SCHEMA__", filePath: "system" }
            ];
            table = await connection.createTable(tableName, initialSchema);
        }

        return new VectorDB(connection, table);
    }

    async insertChunk(chunks: { vector:number[]; text: string; filePath: string[] }[]): Promise<void> {
        await this.table.add(chunks);
    }

    async vectorSearch(queryVector: number[], limit: number = 3): Promise<any[]> {
        const results = await this.table.search(queryVector).limit(limit).toArray();

        return results.filter(row => row.filePath !== "system");
    }

    async clearAll(): Promise<void> {
        const initialSchema = [{ vector: Array(1536).fill(0), text: "__INITIAL_SCHEMA__", filePath: "system" }];
        this.table = await this.connection.createTable(this.tableName, initialSchema, { mode: 'overwrite' });
    }

}
