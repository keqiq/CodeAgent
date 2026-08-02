import { VectorDB } from "./vectorDB";
import { CodeChunker } from "./chunker";
import { EmbedProvider } from "../apis/embed/embedProvider";
import * as vscode from 'vscode';
import { getWorkspaceUri } from "../utils/workspace";
// import * as crypto from 'crypto';
import { supportedExtensions, languageExcludePatterns, globalExcludePatterns} from "./languages/_languageIndex";
import { EmbedFactory } from "../apis/embed/embedFactory";
import { minimatch } from "minimatch";

export type IndexState = 'unindexed' | 'indexed' | 'indexing' | 'error';

export type IndexStatusMessage = 
    | { type: 'updateIndexStatus', state: 'unindexed', text?: string }
    | { type: 'updateIndexStatus', state: 'indexing', text: string }
    | { type: 'updateIndexStatus', state: 'error', text: string }
    | { type: 'updateIndexStatus', state: 'indexed', vectorCount: number }
    | { type: 'updateIndexStatus', state: 'queued', fileCount: number, delay: number }
    | { type: 'updateIndexStatus', state: 'outdated', text: string };

export class Indexer {

    private db?: VectorDB;

    private dirtyFiles = new Set<string>();
    private deletedFiles = new Set<string>();
    private headerDirtyFiles = new Set<string>();
    private debounceTimer?: NodeJS.Timeout;
    private flushInProgress = false;

    private emitter = new vscode.EventEmitter<IndexStatusMessage>();
    public readonly onDidUpdateStatus = this.emitter.event;

    private readonly excludePattern = [...globalExcludePatterns, ...languageExcludePatterns];

    /** Regex to detect agent worktree directories so we can ignore them in file watchers */
    private static readonly worktreePattern = /[\/\\]\.agent-worktree-\d+[\/\\]/;

    /** Returns true if the URI path is inside an agent worktree directory */
    private isWorktreePath(uri: vscode.Uri): boolean {
        return Indexer.worktreePattern.test(uri.fsPath);
    }

    private watcher: vscode.FileSystemWatcher;
    private renameDisposable: vscode.Disposable;

    private constructor(private readonly context: vscode.ExtensionContext,
        private readonly model: string,
        private readonly cc: CodeChunker,
        private readonly getApiKey: (provider: string) => Promise<string>,
        db?: VectorDB
    ) {
        this.db = db;

        const extGlob = supportedExtensions.map(ext => ext.replace(/^\./, '')).join(',');
        const watchPattern = `**/*.{${extGlob}}`;

        // Exclude agent worktrees from the file watcher to prevent ENOENT
        // errors when a worktree is deleted after applying an agent's changes.
        this.watcher = vscode.workspace.createFileSystemWatcher(watchPattern);
        
        // Watch for file edits, add edited files to the index queue. The watcher
        // glob cannot express our exclude patterns, so filter every event here.
        this.watcher.onDidChange(async uri => {
            if (!this.shouldWatch(uri)) return;
            this.markWorkspaceModified();
            if (!this.indexEnabled() || !this.db) return;
            this.scheduleIndex([vscode.workspace.asRelativePath(uri)]);
        });

        // Watch for file creation, add created files to the index queue and update neighbouring files' headers
        this.watcher.onDidCreate(async uri => {
            if (!this.shouldWatch(uri)) return;
            this.markWorkspaceModified();
            if (!this.indexEnabled() || !this.db) return;
            this.scheduleIndex([vscode.workspace.asRelativePath(uri)]);
            await this.scheduleNeighbourHoodUpdate(uri);
        });

        // Watch for file deletion, add deleted files to the deletion queue and update neighbouring files' headers
        this.watcher.onDidDelete(async uri => {
            if (!this.shouldWatch(uri)) return;
            this.markWorkspaceModified();
            if (!this.indexEnabled() || !this.db) return;
            this.scheduleDeleteFile([vscode.workspace.asRelativePath(uri)]);
            await this.scheduleNeighbourHoodUpdate(uri);
        });

        // Watch for file file rename, update header for all neighbors and imports
        this.renameDisposable = vscode.workspace.onDidRenameFiles(async (e) => {
            this.markWorkspaceModified();
            if (!this.indexEnabled() || !this.db) return;
            for (const file of e.files) {
                // Skip renames involving worktree or excluded/generated files.
                if (this.isWorktreePath(file.oldUri) || this.isWorktreePath(file.newUri)) continue;

                const oldPath = vscode.workspace.asRelativePath(file.oldUri);
                const newPath = vscode.workspace.asRelativePath(file.newUri);
                const oldIsIndexable = this.isSupportedFile(oldPath) && !this.isExcluded(oldPath);
                const newIsIndexable = this.isSupportedFile(newPath) && !this.isExcluded(newPath);

                if (newIsIndexable) {
                    this.scheduleIndex([newPath]);
                }

                if (oldIsIndexable) {
                    this.scheduleDeleteFile([oldPath]);
                }

                const dependants = await this.findDependantFiles(oldPath);
                for (const dep of dependants) {
                    if (!this.dirtyFiles.has(dep) && !this.deletedFiles.has(dep)) {
                        this.headerDirtyFiles.add(dep);
                    }
                }

            }
            this.resetDebounceTimer();
        });
    }

    static async create(context: vscode.ExtensionContext, model: string, getAPIKey: (provider: string) => Promise<string>) {
        const cc = await CodeChunker.create(context.extensionUri);

        let db: VectorDB | undefined;
        try {
            db = await VectorDB.create(context, model);
        } catch (e) {
            console.log(`Failed to connect to database: ${e}`);
            db = undefined;
        }

        return new Indexer(context, model, cc, getAPIKey, db);
    }

    public dispose(): void {
        this.watcher.dispose();
        this.renameDisposable.dispose();
        this.emitter.dispose();
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
    }

    public async broadcastCurrentState(): Promise<void> {
        if (this.db) {

            const lastModified = this.context.workspaceState.get<number>('lastModified') || 0;
            const dbTimestamps = this.context.workspaceState.get<Record<string, number>>('dbTimestamps') || {};
            const tableTimeStamp = dbTimestamps[this.model] || 0;

            const count = await this.db.getVectorCount();

            if (tableTimeStamp > 0 && lastModified > tableTimeStamp) {
                this.emitter.fire({
                    type: 'updateIndexStatus',
                    state: 'outdated',
                    text: 'Out of Sync'
                });
            }
            else {
                this.emitter.fire({ 
                    type: 'updateIndexStatus', 
                    state: 'indexed', 
                    vectorCount: count 
                });

            }
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
            const syncTime = this.context.workspaceState.get<number>('lastModified') || Date.now();
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
            await this.markDatabaseSynced(syncTime);

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
    
    public scheduleIndex(filePaths: string[]): void {
        for (const filePath of filePaths) {
            this.dirtyFiles.add(filePath);
            this.headerDirtyFiles.delete(filePath);
            this.deletedFiles.delete(filePath);
        }
        this.resetDebounceTimer();
    }

    public scheduleDeleteFile(filePaths: string[]): void {
        for (const filePath of filePaths) {
            this.deletedFiles.add(filePath);
            this.dirtyFiles.delete(filePath);
            this.headerDirtyFiles.delete(filePath);
        }
        this.resetDebounceTimer();
    }

    public async scheduleNeighbourHoodUpdate(triggerUri: vscode.Uri): Promise<void> {
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

            this.resetDebounceTimer();
        } catch (e) {
            console.warn(`Failed to schedule neighbourhood update`, e);
        }
    }

    public async search(queryText: string, vector: number[]): Promise<any[]> {
        const limit = this.context.globalState.get<number>('retrievalCount') ?? 10;
        return this.db!.hybridSearch(queryText, vector, limit);
    }

    private async indexFile(filePath: string, embedProvider: EmbedProvider, model: string): Promise<void> {
        if (!this.db) throw new Error("Cannot index file: VectorDB is not connected");

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

    /**
     * The FileSystemWatcher only supports an include glob. Keep its events in
     * sync with chunkWorkspace() by applying the same exclusions here. This is
     * important for generated bundles: the extension build writes dist/*.js,
     * which otherwise looks like user source to the JavaScript watcher.
     */
    private shouldWatch(uri: vscode.Uri): boolean {
        if (this.isWorktreePath(uri)) return false;

        const relativePath = vscode.workspace.asRelativePath(uri);
        return this.isSupportedFile(relativePath) && !this.isExcluded(relativePath);
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
                vector: Array.from(row.vector),
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

    private async flushIndexQueue(): Promise<void> {
        // Build/watch events can arrive while embedding is in progress. Do not
        // run concurrent database mutations; leave newly queued files in the
        // sets and schedule a second pass when this one completes.
        if (this.flushInProgress) return;
        this.flushInProgress = true;

        const provider = this.context.globalState.get<string>("embedProvider");

        if (!provider) {
            this.flushInProgress = false;
            return;
        }

        try {
            const apiKey = await this.getApiKey(provider);
            if (!apiKey) throw new Error(`${provider} API key missing`);
        
            if (!this.db) throw new Error(`Failed to flush queue: Database not connected`);

            const syncTime = this.context.workspaceState.get<number>('lastModified') || Date.now();

            const deletedFiles = [...this.deletedFiles];

            // Filter once more just in case
            // Don't reindex files that are for deletion
            // Don't update headers for files that are for deletion or for indexing
            const dirtyFiles = [...this.dirtyFiles].filter(f => !this.deletedFiles.has(f));
            const headerDirtyFiles = [...this.headerDirtyFiles].filter(f =>
                !this.dirtyFiles.has(f) && !this.deletedFiles.has(f)
            );

            if (deletedFiles.length === 0 && dirtyFiles.length === 0 && headerDirtyFiles.length === 0) return;
            
            this.dirtyFiles.clear();
            this.deletedFiles.clear();
            this.headerDirtyFiles.clear();

            
            const embedProvider = EmbedFactory.create(provider, apiKey);
        
            if (deletedFiles.length > 0) {
                this.emitter.fire({ type: 'updateIndexStatus', state: 'indexing', text: `Deleting ${deletedFiles.length} file(s)...` });
                for (const file of deletedFiles) await this.deleteFile(file);
            }

            if (dirtyFiles.length > 0) {
                this.emitter.fire({ type: 'updateIndexStatus', state: 'indexing', text: `Indexing ${dirtyFiles.length} files(s)...`});
                for (const file of dirtyFiles) await this.indexFile(file, embedProvider, this.model);
            }

            if (headerDirtyFiles.length > 0) {
                this.emitter.fire({ type: 'updateIndexStatus', state: 'indexing', text: `Updating ${headerDirtyFiles.length} header(s)...`});
                for (const file of headerDirtyFiles) await this.updateFileHeader(file);
            }
            this.cc.clearNeighbourHoodCache();

            await this.markDatabaseSynced(syncTime);

            const vectorCount = await this.db!.getVectorCount();
            this.emitter.fire({
                type: 'updateIndexStatus',
                state: 'indexed',
                vectorCount: vectorCount,
            });
        } catch (e) {
            console.error(`Failed to flush index queue: ${e}`);

            this.emitter.fire({
                type: 'updateIndexStatus',
                state: 'error',
                text: e instanceof Error ? e.message : String(e)
            });
        } finally {
            this.flushInProgress = false;

            // Events received during the flush were intentionally not cleared.
            // Process them in a separate pass rather than losing them or
            // running another flush concurrently.
            if (this.dirtyFiles.size > 0 || this.deletedFiles.size > 0 || this.headerDirtyFiles.size > 0) {
                this.resetDebounceTimer();
            }
        }
    }

    private resetDebounceTimer(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        const fileCount = this.dirtyFiles.size + this.deletedFiles.size + this.headerDirtyFiles.size;
        const delay = this.context.globalState.get<number>('debounceTime') ?? 10;

        if (fileCount > 0) {
            this.emitter.fire({
                type: 'updateIndexStatus',
                state: 'queued',
                fileCount: fileCount,
                delay: delay
            });
        }
        
        this.debounceTimer = setTimeout(() => {
            void this.flushIndexQueue();
        }, delay * 1000);
    }

    // After flushing queue, store the time stamp of the latest edits
    private markWorkspaceModified(): void {
        this.context.workspaceState.update('lastModified', Date.now());
    }

    // Set the current table to the latest edit timestamp
    private async markDatabaseSynced(syncTimestamp: number): Promise<void> {
        const dbTimestamps = this.context.workspaceState.get<Record<string, number>>('dbTimestamps') || {};
        dbTimestamps[this.model] = syncTimestamp;
        await this.context.workspaceState.update('dbTimestamps', dbTimestamps);
    }

    public async deleteIndex(): Promise<void> {
        if (this.db) {
            await this.db.dropTable();
            this.db = undefined;
        }

        this.dirtyFiles.clear();
        this.deletedFiles.clear();
        this.headerDirtyFiles.clear();
        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        const dbTimestamps = this.context.workspaceState.get<Record<string, number>>('dbTimestamps') || {};
        delete dbTimestamps[this.model];
        await this.context.workspaceState.update('dbTimestamps', dbTimestamps);

        this.emitter.fire({
            type: 'updateIndexStatus',
            state: 'unindexed',
            text: 'Not Indexed'
        });
    }

    // private static debugVector(label: string, vector: ArrayLike<number>, text: string) {
    //     const values = Array.from(vector);

    //     const textHash = crypto
    //         .createHash('sha256')
    //         .update(text)
    //         .digest('hex')
    //         .slice(0, 12);

    //     console.log(`[INDEX DEBUG] ${label}`);
    //     console.log(`  textHash: ${textHash}`);
    //     console.log(`  dimension: ${values.length}`);
    //     console.log(`  first10: ${values.slice(0, 10).map(n => Number(n).toFixed(5)).join(', ')}`);
    //     console.log(`  preview: ${text.slice(0, 160).replace(/\s+/g, ' ')}`);
    // }

}