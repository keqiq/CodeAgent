import { VectorDB } from "./vectorDB";
import { CodeChunker } from "./chunker";
import { EmbedProvider } from "../apis/embed/embedProvider";
import * as vscode from 'vscode';
import { getWorkspaceUri } from "../utils/workspace";
import * as crypto from 'crypto';

export class Indexer {
    
    private db?: VectorDB;

    private constructor(private readonly context: vscode.ExtensionContext, 
                        private readonly cc: CodeChunker,
                        db?: VectorDB
    ) {
        this.db = db;
    }

    static async create(context: vscode.ExtensionContext) {
      const cc = await CodeChunker.create(context.extensionUri);

      let db: VectorDB | undefined;
      try {
        db = await VectorDB.create(context);
      } catch (e) {
        console.log(`Failed to connect to database: ${e}`);
        db = undefined;
      }

      return new Indexer(context, cc, db);
    }

    // Initial indexing of all relevant files in the workspace
    public async indexWorkspace(embedProvider: EmbedProvider, model: string): Promise<void> {
        const chunks = await this.cc.chunkWorkspace();
        if (chunks.length === 0) return;
        const texts = chunks.map(chunk => chunk.text);

        const vectors = await embedProvider.embed(model, texts);
        const dimension = vectors[0].length;

        console.log('Embedding complete');

        this.db = await VectorDB.create(this.context, dimension);
        const rows = chunks.map((chunk, i) =>  ({
            vector:vectors[i],
            ...chunk
        }));

        await this.db.insertRows(rows);
    }

    public async reindexFile(filePath: string, embedProvider: EmbedProvider, model: string): Promise<void> {
        if (!this.db) throw new Error("Cannot reindex file: VectorDB is not connected");

        const workspaceUri = getWorkspaceUri(filePath);
        const chunks = await this.cc.chunkFile(workspaceUri);
        await this.db.deleteByFilePath(filePath);

        // console.log(`[INDEX DEBUG] chunk count for ${filePath}: ${chunks.length}`);
        // console.log(`[INDEX DEBUG] first chunk preview: ${chunks[0]?.text.slice(0, 120).replace(/\s+/g, ' ')}`);

        if (chunks.length === 0) return;

        const texts = chunks.map(chunk => chunk.text);
        const vectors = await embedProvider.embed(model, texts);

        // console.log(`[INDEX DEBUG] Embedded ${vectors.length} vector(s)`);

        const rows = chunks.map((chunk, i) => ({
            vector: vectors[i],
            ...chunk
        }));

        await this.db.insertRows(rows);

        const storedRows = await this.db.getRowsByFilePath(filePath);
        // console.log(`[INDEX DEBUG] Stored row count after insert: ${storedRows.length}`);

        for (let i = 0; i < Math.min(3, storedRows.length); i++) {
            this.debugVector(`stored vector ${i + 1} for ${filePath}`, storedRows[i].vector, storedRows[i].text);
        }
    }

    public async search(vector: number[], limit: number = 10): Promise<any[]> {
        return this.db!.vectorSearch(vector, limit);
    }

    public async deleteFile(filePath: string): Promise<void> {
        if (!this.db) throw new Error("Cannot delete file: VectorDB is not connected");
        await this.db.deleteByFilePath(filePath);
    }

    public dbConnected(): boolean {
        return this.db !== undefined;
    }

    private debugVector(label: string, vector: ArrayLike<number>, text: string) {
        const values = Array.from(vector);

        const textHash = crypto
            .createHash('sha256')
            .update(text)
            .digest('hex')
            .slice(0, 12);

        console.log(`[INDEX DEBUG] ${label}`);
        console.log(`  textHash: ${textHash}`);
        console.log(`  dimension: ${values.length}`);
        console.log(`  first10: ${values.slice(0, 10).map(n => Number(n).toFixed(5)).join(', ')}`);
        console.log(`  preview: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
    }

}