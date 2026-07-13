import { VectorDB } from "./vectorDB";
import { CodeChunker } from "./chunker";
import { EmbedProvider } from "../apis/embed/embedProvider";
import * as vscode from 'vscode';
import { getWorkspaceUri } from "../utils/workspace";
import * as crypto from 'crypto';
import { supportedExtensions, languageExcludePatterns, globalExcludePatterns} from "./languages/_languageIndex";
import { EmbedFactory } from "../apis/embed/embedFactory";
import { minimatch } from "minimatch";

export type IndexState = 'unindexed' | 'indexed' | 'indexing' | 'error';

export type IndexStatusMessage = 
    | { type: 'updateIndexStatus', state: 'unindexed', text?: string }
    | { type: 'updateIndexStatus', state: 'indexing', text: string }
    | { type: 'updateIndexStatus', state: 'error', text: string }
    | { type: 'updateIndexStatus', state: 'indexed', vectorCount: number };

export class Indexer {

    private db?: VectorDB;

    private dirtyFiles = new Set<string>();
    private deletedFiles = new Set<string>();
    private headerDirtyFiles = new Set<string>();
    private reindexTimer?: NodeJS.Timeout;

    private emitter = new vscode.EventEmitter<IndexStatusMessage>();
    public readonly onDidUpdateStatus = this.emitter.event;

    private readonly excludePattern = [...globalExcludePatterns, ...languageExcludePatterns];

    private constructor(private readonly context: vscode.ExtensionContext,
        private readonly cc: CodeChunker,
        db?: VectorDB
    ) {
        this.db = db;

        const extGlob = supportedExtensions.map(ext => ext.replace(/^\./, '')).join(',');
        const watchPattern = `**/*.{${extGlob}}`;

        const watcher = vscode.workspace.createFileSystemWatcher(watchPattern);
        
        // Watch for file edits, add editted files to reindex queue
        watcher.onDidChange(async uri => {
            if (!this.indexEnabled()) return;
            this.scheduleReindex([vscode.workspace.asRelativePath(uri)]);
        });

        // Watch for file creation, add created file to reindex queue and update neighbouring files' headers
        watcher.onDidCreate(async uri => {
            if (!this.indexEnabled()) return;
            this.scheduleReindex([vscode.workspace.asRelativePath(uri)]);
            await this.scheduleNeighbourHoodUpdate(uri);
        });

        // Watch for file deletion, add deleted file to deletion queue and update neighbouring files' headers
        watcher.onDidDelete(async uri => {
            if (!this.indexEnabled()) return;
            this.scheduleDeleteFile([vscode.workspace.asRelativePath(uri)]);
            await this.scheduleNeighbourHoodUpdate(uri);
        });

        vscode.workspace.onDidRenameFiles(async (e) => {
            if (!this.indexEnabled()) return;
            for (const file of e.files) {
                const oldPath = vscode.workspace.asRelativePath(file.oldUri);
                const newPath = vscode.workspace.asRelativePath(file.newUri);

                if (this.isSupportedFile(newPath) && !this.isExcluded(newPath)) {
                    this.scheduleReindex([newPath]);
                }

                if (this.isSupportedFile(oldPath)) {
                    this.scheduleDeleteFile([oldPath]);
                }

                const dependants = await this.findDependantFiles(oldPath);
                for (const dep of dependants) {
                    if (!this.dirtyFiles.has(dep) && !this.deletedFiles.has(dep)) {
                        this.headerDirtyFiles.add(dep);
                    }
                }

            }
            this.resetReindexTimer();
        });
    }

    static async create(context: vscode.ExtensionContext, model: string) {
        const cc = await CodeChunker.create(context.extensionUri);

        let db: VectorDB | undefined;
        try {
            db = await VectorDB.create(context, model);
        } catch (e) {
            console.log(`Failed to connect to database: ${e}`);
            db = undefined;
        }

        return new Indexer(context, cc, db);
    }

    public async broadcastCurrentState(): Promise<void> {
        if (this.db) {
            const count = await this.db.getVectorCount();
            this.emitter.fire({ 
                type: 'updateIndexStatus', 
                state: 'indexed', 
                vectorCount: count 
            });
        } else {
            this.emitter.fire({ 
                type: 'updateIndexStatus', 
                state: 'unindexed', 
                text: 'Not Indexed' 
            });
        }
    }

    // Initial indexing of all relevant files in the workspace
    public async indexWorkspace(embedProvider: EmbedProvider, model: string): Promise<void> {

        try {
            this.emitter.fire({ type: 'updateIndexStatus', state: 'indexing', text: 'Reading workspace...' });

            const chunks = await this.cc.chunkWorkspace();
            this.cc.clearNeighbourHoodCache();

            if (chunks.length === 0) {
                this.emitter.fire({ type: 'updateIndexStatus', state: 'unindexed', text: 'No supported files' });
                return;
            }

            this.emitter.fire({ type: 'updateIndexStatus', state: 'indexing', text: `Embedding ${chunks.length} chunks...` });

            const texts = chunks.map(chunk => chunk.text);
    
            const vectors = await embedProvider.embed(model, texts);
            const dimension = vectors[0].length;

            this.emitter.fire({ type: 'updateIndexStatus', state: 'indexing', text: 'Saving to database...' });
    
            this.db = await VectorDB.create(this.context, model, dimension);
            const rows = chunks.map((chunk, i) => ({
                vector: vectors[i],
                ...chunk
            }));
    
            await this.db.insertRows(rows);
            const vectorCount = await this.db.getVectorCount();
            this.emitter.fire({ type: 'updateIndexStatus', state: 'indexed', vectorCount: vectorCount });
        } catch (e) {
            console.error(`Workspace indexing failed: ${e}`);
            this.emitter.fire({
                    type: 'updateIndexStatus',
                    state: 'error',
                    text: e instanceof Error ? e.message : String(e)
            });
        } 
    }
    
    public scheduleReindex(filePaths: string[]) {
        for (const filePath of filePaths) {
            this.dirtyFiles.add(filePath);
            this.headerDirtyFiles.delete(filePath);
        }
        this.resetReindexTimer();
    }

    public scheduleDeleteFile(filePaths: string[]) {
        for (const filePath of filePaths) {
            this.deletedFiles.add(filePath);
            this.dirtyFiles.delete(filePath);
            this.headerDirtyFiles.delete(filePath);
        }
        this.resetReindexTimer();
    }

    public async scheduleNeighbourHoodUpdate(triggerUri: vscode.Uri) {
        try {
            const parentUri = vscode.Uri.joinPath(triggerUri, '..');
            const entries = await vscode.workspace.fs.readDirectory(parentUri);
            const triggerFileName = triggerUri.path.split('/').pop();

            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name !== triggerFileName) {
                    const siblingUri = vscode.Uri.joinPath(parentUri, name);
                    const siblingPath = vscode.workspace.asRelativePath(siblingUri);
                    
                    if (this.isSupportedFile(name) && !this.isExcluded(siblingPath)) {
                        if (!this.dirtyFiles.has(siblingPath) && !this.deletedFiles.has(siblingPath)) {
                            this.headerDirtyFiles.add(siblingPath);
                        }
                    }
                }
            }

            this.resetReindexTimer();
        } catch (e) {
            console.warn(`Failed to schedule neighbourhood update`, e);
        }
    }

    public async search(queryText: string, vector: number[]): Promise<any[]> {
        const limit = this.context.globalState.get<number>('retrievalCount') ?? 10;
        return this.db!.hybridSearch(queryText, vector, limit);
    }

    private async reindexFile(filePath: string, embedProvider: EmbedProvider, model: string): Promise<void> {
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

        // const storedRows = await this.db.getRowsByFilePath(filePath);
        // console.log(`[INDEX DEBUG] Stored row count after insert: ${storedRows.length}`);

        // for (let i = 0; i < Math.min(3, storedRows.length); i++) {
        //     Indexer.debugVector(`stored vector ${i + 1} for ${filePath}`, storedRows[i].vector, storedRows[i].text);
        // }
    }

    private async deleteFile(filePath: string): Promise<void> {
        if (!this.db) throw new Error("Cannot delete file: VectorDB is not connected");
        await this.db.deleteByFilePath(filePath);
    }

    private isSupportedFile(fileName: string): boolean {
        return supportedExtensions.some(ext => fileName.endsWith(ext));
    }

    private isExcluded(filePath: string): boolean {
        return this.excludePattern.some(pattern => minimatch(filePath, pattern, { dot: true}));
    }

    public indexEnabled(): boolean {
        return this.context.globalState.get<boolean>('indexEnabled') ?? true;
    }

    private async updateFileHeader(filePath: string): Promise<void> {
        if (!this.db) throw new Error('Cannot update file: VectorDB is not connected');

        const existingRows = await this.db.getRowsByFilePath(filePath);
        if (existingRows.length === 0) return;

        const workspaceUri = getWorkspaceUri(filePath);

        const { imports, siblings } = await this.cc.getFileContext(workspaceUri);

        const siblingsRegex = /\[SIBLINGS\][\s\S]*?\[\/SIBLINGS\]/;
        const importsRegex = /\[IMPORTS\][\s\S]*?\[\/IMPORTS\]/;

        const rowsToUpdate = existingRows.map(row => {
            let updatedText = row.text;

            if (siblingsRegex.test(updatedText)) {
                updatedText = updatedText.replace(siblingsRegex, siblings);
            }

            if (importsRegex.test(updatedText)) {
                updatedText = updatedText.replace(importsRegex, imports);
            }

            return {
                ...row,
                text: updatedText
            };
        });
        
        await this.db.deleteByFilePath(filePath);
        await this.db.insertRows(rowsToUpdate);
    }

    private async findDependantFiles(oldFileName: string): Promise<string[]> {
        if (!this.db) throw new Error('Cannot find dependant files: VectorDB is not Connected');

        const importName = oldFileName.replace(/\.[^/.]+$/, "");
        const dependants = await this.db.getFilePathByImport(importName);

        const uniqueFiles = new Set(dependants.map(r => r.filePath));
        uniqueFiles.delete(oldFileName); 

        return Array.from(uniqueFiles);
    }

    private async flushReindexQueue() {
        const providerId = this.context.globalState.get<string>("embedProvider");
        const model = this.context.globalState.get<string>("embedModel");
        
        if (!providerId || !model) return;
        
        // const apiKey = await getEmbedAPIKey(this.context, providerId);
        // TODO: FIX THIS
        const apiKey = this.context.globalState.get<string>(`${providerId.toUpperCase()}_EMBED_API_KEY`);
        if (!apiKey) return;
        if (!this.db) return;

        const deletedFiles = [...this.deletedFiles];

        // Filter once more just in case
        // Don't reindex files that are for deletion
        // Don't update headers for files that are for deletion or for reindexing
        const dirtyFiles = [...this.dirtyFiles].filter(f => !this.deletedFiles.has(f));
        const headerDirtyFiles = [...this.headerDirtyFiles].filter(f =>
            !this.dirtyFiles.has(f) && !this.deletedFiles.has(f)
        );
        
        this.dirtyFiles.clear();
        this.deletedFiles.clear();
        this.headerDirtyFiles.clear();

        this.emitter.fire({
            type: 'updateIndexStatus',
            state: 'indexing',
            text: `Reindexing ${dirtyFiles.length + deletedFiles.length + headerDirtyFiles.length} file(s)...`
        });

        const embedProvider = EmbedFactory.create(providerId, apiKey);

        try {
            for (const file of deletedFiles) await this.deleteFile(file);
            for (const file of dirtyFiles) await this.reindexFile(file, embedProvider, model);
            for (const file of headerDirtyFiles) await this.updateFileHeader(file);
            this.cc.clearNeighbourHoodCache();

            const vectorCount = await this.db!.getVectorCount();
            this.emitter.fire({
                type: 'updateIndexStatus',
                state: 'indexed',
                vectorCount: vectorCount,
            });
        } catch (e) {
            console.error(`Failed to flush reindex queue: ${e}`);

            this.emitter.fire({
                type: 'updateIndexStatus',
                state: 'error',
                text: e instanceof Error ? e.message : String(e)
            });
        }
    }

    private resetReindexTimer() {
        if (this.reindexTimer) clearTimeout(this.reindexTimer);

        this.reindexTimer = setTimeout(() => {
            void this.flushReindexQueue();
        }, 5000);
    }

    private static debugVector(label: string, vector: ArrayLike<number>, text: string) {
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