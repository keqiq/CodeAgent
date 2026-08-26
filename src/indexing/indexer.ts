import * as vscode from 'vscode';
import { VectorDB, VectorRow } from "./vectorDB";
import { CodeChunk, CodeChunker } from './chunker';
import { APIManager } from '../managers/apiManager';
import { Watcher } from './watcher';
import { EmbedFactory } from '../apis/embed/embedFactory';
import { getWorkspaceUri } from '../utils/workspace';

export type IndexState = 'unindexed' | 'indexed' | 'indexing' | 'error';

export type IndexStatusMessage = 
    | { type: 'updateIndexStatus', state: 'unindexed', text?: string }
    | { type: 'updateIndexStatus', state: 'indexing', text: string }
    | { type: 'updateIndexStatus', state: 'error', text: string }
    | { type: 'updateIndexStatus', state: 'indexed', vectorCount: number }
    | { type: 'updateIndexStatus', state: 'queued', fileCount: number, delay: number }
    | { type: 'updateIndexStatus', state: 'outdated', text: string };

export class Indexer {
    private database? : VectorDB;

    private dirtyFiles = new Set<string>();
    private deletedFiles = new Set<string>();
    private headerDirtyFiles = new Set<string>();

    private watcher: Watcher;
    
    private debounceTimer?: NodeJS.Timeout;
    private flushInProgress = false;

    private emitter = new vscode.EventEmitter<IndexStatusMessage>();
    public readonly onDidUpdateStatus = this.emitter.event;

    private constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly model: string,
        private readonly apiManager: APIManager,
        private readonly chunker: CodeChunker,
        database?: VectorDB
    ) {
        this.database = database;

        this.watcher = new Watcher({
            dirtyFiles: this.dirtyFiles,
            deletedFiles: this.deletedFiles,
            headerDirtyFiles: this.headerDirtyFiles,
            onQueueChanged: () => this.resetDebounceTimer(),
            onWorkspaceModified: () => this.markWorkspaceModified(),
            isReady: () => this.isReadyToIndex(),
            getDependentFiles: (oldPath) => this.findDependantFiles(oldPath)
        });
    }

    static async create(context: vscode.ExtensionContext, model: string, apiManager: APIManager) {
        const chunker = await CodeChunker.create(context.extensionUri);

        let database: VectorDB | undefined;
        try {
            database = await VectorDB.create(context, model);
        } catch (e) {
            console.log(`Failed to connect to database: ${e}`);
            database = undefined;
        }

        return new Indexer(context, model, apiManager, chunker, database);
    }

    // Update the timestamp for the last modification to track which database is in or out of sync
    // This is quick and dirty, it will not track which files are modified and needs reindexing
    private markWorkspaceModified(): void {
        this.context.workspaceState.update('lastModified', Date.now());
    }

    // Set the current table to the latest edit timestamp
    private async markDatabaseSynced(syncTimestamp: number): Promise<void> {
        const dbTimestamps = this.context.workspaceState.get<Record<string, number>>('dbTimestamps') || {};
        dbTimestamps[this.model] = syncTimestamp;
        await this.context.workspaceState.update('dbTimestamps', dbTimestamps);
    }

    public indexEnabled(): boolean {
        return this.context.globalState.get<boolean>('indexEnabled') ?? true;
    }

    private async isReadyToIndex(): Promise<boolean> {
        const provider = this.context.globalState.get<string>('embedProvider') || '';
        try {
            await this.apiManager.getEmbedAPIKey(provider);
            return Boolean(this.indexEnabled() && this.database);
        } catch {
            return false;
        }
    }

    public resetDebounceTimer(): void {
        if (this.debounceTimer) clearTimeout(this.debounceTimer);

        const fileCount = this.dirtyFiles.size + this.deletedFiles.size + this.headerDirtyFiles.size;
        if (fileCount === 0) return;

        const delay = this.context.globalState.get<number>('debounceTime') ?? 10;

        this.emitter.fire({
            type: 'updateIndexStatus',
            state: 'queued',
            fileCount,
            delay
        });
        
        this.debounceTimer = setTimeout(() => {
            void this.flushIndexQueue();
        }, delay * 1000);
    }

    private async flushIndexQueue(): Promise<void> {
        if (this.flushInProgress) return;
        if (!this.isReadyToIndex() || !this.database) {
            this.flushInProgress = false;
            return;
        }
        this.flushInProgress = true;

        // Snapshot current targets
        const filesToDelete = Array.from(this.deletedFiles);
        const filesToIndex = Array.from(this.dirtyFiles).filter(f => !this.deletedFiles.has(f));
        const filesForHeaderUpdate = Array.from(this.headerDirtyFiles).filter(
            f => !this.dirtyFiles.has(f) && !this.deletedFiles.has(f)
        );

        if (filesToDelete.length === 0 && filesToIndex.length === 0 && filesForHeaderUpdate.length === 0) {
            this.flushInProgress = false;
            return;
        }

        const successfulDeletions = new Set<string>();
        const successfulIndexes = new Set<string>();
        const successfulHeaders = new Set<string>();

        const provider = this.context.globalState.get<string>('embedProvider') || '';

        try {
            const apiKey = await this.apiManager.getEmbedAPIKey(provider);

            const embedProvider = EmbedFactory.create(provider, apiKey);
            const syncTime = this.context.workspaceState.get<number>('lastModified') || Date.now();

            // 1. Process deletions
            if (filesToDelete.length > 0) {
                this.emitter.fire({ 
                    type: 'updateIndexStatus', 
                    state: 'indexing', 
                    text: `Deleting ${filesToDelete.length} file(s)...` 
                });

                for (const filePath of filesToDelete) {
                    await this.database!.deleteByFilePath(filePath);
                    successfulDeletions.add(filePath);
                }
            }

            // 2. Process modified/created files
            if (filesToIndex.length > 0) {
                this.emitter.fire({ 
                    type: 'updateIndexStatus', 
                    state: 'indexing', 
                    text: `Chunking ${filesToIndex.length} file(s)...` 
                });

                const allChunks: CodeChunk[] = [];
                const filesWithChunks = new Set<string>();

                for (const filePath of filesToIndex) {
                    // Check if file was deleted during the debounce/flush window
                    if (this.deletedFiles.has(filePath)) continue;

                    const workspaceUri = getWorkspaceUri(filePath);
                    try {
                        await vscode.workspace.fs.stat(workspaceUri);
                        const fileChunks = await this.chunker.chunkFile(workspaceUri);
                        
                        // Clean existing rows before reinserting new chunks
                        await this.database.deleteByFilePath(filePath);

                        if (fileChunks.length > 0) {
                            allChunks.push(...fileChunks);
                            filesWithChunks.add(filePath);
                        }
                        successfulIndexes.add(filePath);
                    } catch {
                        // File was deleted or inaccessible; purge its DB rows and mark handled
                        await this.database.deleteByFilePath(filePath);
                        successfulIndexes.add(filePath);
                    }
                }

                // Batch embed all collected chunks
                if (allChunks.length > 0) {
                    this.emitter.fire({ 
                        type: 'updateIndexStatus', 
                        state: 'indexing', 
                        text: `Embedding ${allChunks.length} chunk(s)...` 
                    });

                    const BATCH_SIZE = 100;
                    const rowsToInsert: VectorRow[] = [];

                    for (let i = 0; i < allChunks.length; i += BATCH_SIZE) {
                        const chunkSlice = allChunks.slice(i, i + BATCH_SIZE);
                        const texts = chunkSlice.map(c => c.text);
                        const vectors = await embedProvider.embed(this.model, texts);

                        for (let j = 0; j < chunkSlice.length; j++) {
                            // Omit chunk if file was marked deleted while embedding was in flight
                            if (!this.deletedFiles.has(chunkSlice[j].filePath)) {
                                rowsToInsert.push({
                                    vector: vectors[j],
                                    ...chunkSlice[j]
                                });
                            }
                        }
                    }

                    if (rowsToInsert.length > 0) {
                        await this.database.insertRows(rowsToInsert);
                    }
                }
            }

            // 3. Process header updates
            if (filesForHeaderUpdate.length > 0) {
                this.emitter.fire({ 
                    type: 'updateIndexStatus', 
                    state: 'indexing', 
                    text: `Updating ${filesForHeaderUpdate.length} header(s)...` 
                });

                for (const filePath of filesForHeaderUpdate) {
                    if (this.dirtyFiles.has(filePath) || this.deletedFiles.has(filePath)) continue;

                    const workspaceUri = getWorkspaceUri(filePath);
                    try {
                        await vscode.workspace.fs.stat(workspaceUri);
                        await this.updateFileHeader(filePath);
                        successfulHeaders.add(filePath);
                    } catch {
                        // File missing; drop from queue
                        await this.database.deleteByFilePath(filePath);
                        successfulHeaders.add(filePath);
                    }
                }
            }

            // Only remove successfully written files from tracking sets
            for (const path of successfulDeletions) this.deletedFiles.delete(path);
            for (const path of successfulIndexes) this.dirtyFiles.delete(path);
            for (const path of successfulHeaders) this.headerDirtyFiles.delete(path);

            this.chunker.clearNeighbourHoodCache();
            await this.markDatabaseSynced(syncTime);

            const vectorCount = await this.database.getVectorCount();
            this.emitter.fire({ type: 'updateIndexStatus', state: 'indexed', vectorCount });

        } catch (e) {
            console.error(`Failed to flush index queue: ${e}`);
            this.emitter.fire({
                type: 'updateIndexStatus',
                state: 'error',
                text: e instanceof Error ? e.message : String(e)
            });

        } finally {
            this.flushInProgress = false;

            // Trigger another pass if items remain or arrived mid-flush
            if (this.dirtyFiles.size > 0 || this.deletedFiles.size > 0 || this.headerDirtyFiles.size > 0) {
                this.resetDebounceTimer();
            }
        }
    }

    // Create a new database and chunk and embed ALL relevant files in the workspace
    public async indexWorkspace(): Promise<void> {

        try {
            const provider = this.context.globalState.get<string>('embedProvider') || '';
            const apiKey = await this.apiManager.getEmbedAPIKey(provider);
            const providerInstance = EmbedFactory.create(provider, apiKey);

            const syncTime = this.context.workspaceState.get<number>('lastModified') || Date.now();
            this.emitter.fire({ type: 'updateIndexStatus', state: 'indexing', text: 'Reading workspace...' });

            const chunks = await this.chunker.chunkWorkspace();
            this.chunker.clearNeighbourHoodCache();

            if (chunks.length === 0) {
                this.emitter.fire({ type: 'updateIndexStatus', state: 'unindexed', text: 'No supported files' });
                return;
            }

            this.emitter.fire({ type: 'updateIndexStatus', state: 'indexing', text: `Embedding ${chunks.length} chunks...` });

            const BATCH_SIZE = 100;
            const rows: VectorRow[] = [];

            for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
                const slice = chunks.slice(i, i + BATCH_SIZE);
                const texts = slice.map(c => c.text);
                const vectors = await providerInstance.embed(this.model, texts);

                for (let j = 0; j < slice.length; j++) {
                    rows.push({
                        vector: vectors[j],
                        ...slice[j]
                    });
                }
            }

            const dimension = rows[0].vector.length;
            this.emitter.fire({ type: 'updateIndexStatus', state: 'indexing', text: 'Saving to database...' });

            this.database = await VectorDB.create(this.context, this.model, dimension);
            await this.database.insertRows(rows);
            await this.markDatabaseSynced(syncTime);

            this.dirtyFiles.clear();
            this.deletedFiles.clear();
            this.headerDirtyFiles.clear();

            const vectorCount = await this.database.getVectorCount();
            this.emitter.fire({ type: 'updateIndexStatus', state: 'indexed', vectorCount });
        } catch (e) {
            console.error(`Workspace indexing failed: ${e}`);
            this.emitter.fire({
                type: 'updateIndexStatus',
                state: 'error',
                text: e instanceof Error ? e.message : String(e)
            });
        }
    }

    // Update the header only, which contains information like sibling files and imports
    // Wouldn't want to re-embed all sibling files just because a file was renamed, created or deleted
    private async updateFileHeader(filePath: string): Promise<void> {
        if (!this.database) return;

        const existingRows = await this.database.getRowsByFilePath(filePath);
        if (existingRows.length === 0) return;

        const workspaceUri = getWorkspaceUri(filePath);
        const { imports, siblings } = await this.chunker.getFileContext(workspaceUri);

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

        await this.database.deleteByFilePath(filePath);
        await this.database.insertRows(rowsToUpdate);
    }

    private async findDependantFiles(oldFileName: string): Promise<string[]> {
        if (!this.database) return [];

        const importName = oldFileName.replace(/\.[^/.]+$/, "");
        const dependants = await this.database.getFilePathByImport(importName);

        const uniqueFiles = new Set<string>(dependants.map((r: any) => r.filePath));
        uniqueFiles.delete(oldFileName);
        return Array.from(uniqueFiles);
    }

    public async broadcastCurrentState(): Promise<void> {
        if (this.database) {
            const lastModified = this.context.workspaceState.get<number>('lastModified') || 0;
            const dbTimestamps = this.context.workspaceState.get<Record<string, number>>('dbTimestamps') || {};
            const tableTimeStamp = dbTimestamps[this.model] || 0;

            const count = await this.database.getVectorCount();

            if (tableTimeStamp > 0 && lastModified > tableTimeStamp) {
                this.emitter.fire({
                    type: 'updateIndexStatus',
                    state: 'outdated',
                    text: 'Out of Sync'
                });
            } else {
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

    public async search(queryText: string, vector: number[]): Promise<any[]> {
        if (!this.database) throw new Error("VectorDB is not connected");
        const limit = this.context.globalState.get<number>('retrievalCount') ?? 10;
        return this.database.hybridSearch(queryText, vector, limit);
    }

    public async deleteIndex(): Promise<void> {
        if (this.database) {
            await this.database.dropTable();
            this.database = undefined;
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

    public dispose(): void {
        this.watcher.dispose();
        this.emitter.dispose();
        if (this.debounceTimer) clearTimeout(this.debounceTimer);
    }

}