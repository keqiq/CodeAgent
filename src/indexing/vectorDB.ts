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
    private readonly tableName = 'workspace_chunks';

    private constructor(private readonly dimension: number, 
                        private readonly connection: lancedb.Connection, 
                        private table: lancedb.Table
    ) {}

    static async create(context: vscode.ExtensionContext, dimension: number): Promise<VectorDB> {
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
            const initialSchema: Record<string, unknown>[] = [
                {
                    vector: Array(dimension).fill(0),
                    text: "__INITIAL_SCHEMA__",
                    filePath: "sytsem",
                    startLine: 0,
                    endLine: 0,
                    type: "system"
                }
            ];

            table = await connection.createTable(tableName, initialSchema);
        }

        return new VectorDB(dimension, connection, table);
    }

    async insertRows(rows: VectorRow[]): Promise<void> {
        if (rows.length === 0) return;

        await this.table.add(rows as unknown as Record<string, unknown>[]);
    }

    async vectorSearch(queryVector: number[], limit: number = 3): Promise<any[]> {
        const results = await this.table.search(queryVector).limit(limit).toArray();

        return results.filter(row => row.filePath !== "system");
    }

    async clearAll(): Promise<void> {
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
            this.tableName,
            initialSchema,
            { mode: 'overwrite' }
        );
    }

}
