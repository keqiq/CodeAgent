import { VectorDB } from "./vectorDB";
import { CodeChunker } from "./chunker";
import { EmbedProvider } from "../apis/embed/embedProvider";
import * as vscode from 'vscode';

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
    public async indexWorkspace(embedProvider: EmbedProvider, model: string) {
        const chunks = await this.cc.chunkWorkspace();
        if (chunks.length === 0) return;
        const texts = chunks.map(chunk => chunk.text);

        const vectors = await embedProvider.embed(model, texts);
        const dimension = vectors[0].length;

        this.db = await VectorDB.create(this.context, dimension);
        const rows = chunks.map((chunk, i) =>  ({
            vector:vectors[i],
            ...chunk
        }));

        await this.db.insertRows(rows);
    }

    public async search(vector: number[], limit: number = 10): Promise<any[]> {
        return this.db!.vectorSearch(vector, limit);
    }

    public dbConnected(): boolean {
        return this.db !== undefined;
    }

}