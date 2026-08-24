import * as vscode from 'vscode';
import { minimatch } from 'minimatch';
import { supportedExtensions, globalExcludePatterns, languageExcludePatterns } from './languages/_languageIndex';

export interface WatcherOptions {
    dirtyFiles: Set<string>;
    deletedFiles: Set<string>;
    headerDirtyFiles: Set<string>;
    onQueueChanged: () => void;
    onWorkspaceModified: () => void;
    isReady: () => Promise<boolean>;
    getDependentFiles?: (oldFilePath: string) => Promise<string[]>;
}

export class Watcher implements vscode.Disposable {
    private readonly watcher: vscode.FileSystemWatcher;
    private readonly renameDisposable: vscode.Disposable;
    private readonly excludePatterns = [...globalExcludePatterns, ...languageExcludePatterns];

    constructor(private readonly options: WatcherOptions) {
        const extGlob = supportedExtensions.map(ext => ext.replace(/^\./, '')).join(',');
        this.watcher = vscode.workspace.createFileSystemWatcher(`**/*.{${extGlob}}`);

        this.watcher.onDidChange(async uri => await this.handleFileChange(uri));
        this.watcher.onDidCreate(async uri => await this.handleFileCreate(uri));
        this.watcher.onDidDelete(async uri => await this.handleFileDelete(uri));
        this.renameDisposable = vscode.workspace.onDidRenameFiles(async e => await this.handleFileRename(e));
    }

    private normalizePath(filePath: string): string {
        return filePath.replace(/\\/g, '/');
    }

    private isSupportedFile(filePath: string): boolean {
        return supportedExtensions.some(ext => filePath.endsWith(ext));
    }

    private isExcluded(filePath: string): boolean {
        const normalized = this.normalizePath(filePath);
        return this.excludePatterns.some(pattern => minimatch(normalized, pattern, { dot: true }));
    }

    private shouldWatch(uri: vscode.Uri): boolean {
        const relativePath = this.normalizePath(vscode.workspace.asRelativePath(uri));
        return this.isSupportedFile(relativePath) && !this.isExcluded(relativePath);
    }

    private async handleFileChange(uri: vscode.Uri): Promise<void> {
        if (!this.shouldWatch(uri)) return;
        this.options.onWorkspaceModified();
        if (!await this.options.isReady()) return;

        const path = this.normalizePath(vscode.workspace.asRelativePath(uri));
        this.options.dirtyFiles.add(path);
        this.options.deletedFiles.delete(path);
        this.options.headerDirtyFiles.delete(path);
        this.options.onQueueChanged();
    }

    private async handleFileCreate(uri: vscode.Uri): Promise<void> {
        if (!this.shouldWatch(uri)) return;
        this.options.onWorkspaceModified();
        if (!await this.options.isReady()) return;

        const path = this.normalizePath(vscode.workspace.asRelativePath(uri));
        this.options.dirtyFiles.add(path);
        this.options.deletedFiles.delete(path);
        this.options.headerDirtyFiles.delete(path);

        await this.scheduleNeighbourHoodUpdate(uri);
        this.options.onQueueChanged();
    }

    private async handleFileDelete(uri: vscode.Uri): Promise<void> {
        if (!this.shouldWatch(uri)) return;
        this.options.onWorkspaceModified();
        if (!await this.options.isReady()) return;

        const path = this.normalizePath(vscode.workspace.asRelativePath(uri));
        this.options.deletedFiles.add(path);
        this.options.dirtyFiles.delete(path);
        this.options.headerDirtyFiles.delete(path);

        await this.scheduleNeighbourHoodUpdate(uri);
        this.options.onQueueChanged();
    }

    private async handleFileRename(e: vscode.FileRenameEvent): Promise<void> {
        this.options.onWorkspaceModified();
        if (!await this.options.isReady()) return;

        let queueUpdated = false;

        for (const file of e.files) {
            const oldPath = this.normalizePath(vscode.workspace.asRelativePath(file.oldUri));
            const newPath = this.normalizePath(vscode.workspace.asRelativePath(file.newUri));

            if (this.isSupportedFile(oldPath) && !this.isExcluded(oldPath)) {
                this.options.deletedFiles.add(oldPath);
                this.options.dirtyFiles.delete(oldPath);
                this.options.headerDirtyFiles.delete(oldPath);
                queueUpdated = true;
            }

            if (this.isSupportedFile(newPath) && !this.isExcluded(newPath)) {
                this.options.dirtyFiles.add(newPath);
                this.options.deletedFiles.delete(newPath);
                this.options.headerDirtyFiles.delete(newPath);
                queueUpdated = true;
            }

            if (this.options.getDependentFiles && this.isSupportedFile(oldPath)) {
                try {
                    const dependents = await this.options.getDependentFiles(oldPath);
                    for (const dep of dependents) {
                        const normalizedDep = this.normalizePath(dep);
                        if (!this.options.dirtyFiles.has(normalizedDep) && !this.options.deletedFiles.has(normalizedDep)) {
                            this.options.headerDirtyFiles.add(normalizedDep);
                            queueUpdated = true;
                        }
                    }
                } catch (err) {
                    console.warn(`Failed to resolve dependents for ${oldPath}`, err);
                }
            }
        }

        if (queueUpdated) this.options.onQueueChanged();
    }

    private async scheduleNeighbourHoodUpdate(triggerUri: vscode.Uri): Promise<void> {
        try {
            const parentUri = vscode.Uri.joinPath(triggerUri, '..');
            const entries = await vscode.workspace.fs.readDirectory(parentUri);
            const triggerFileName = triggerUri.path.split('/').pop();

            for (const [name, type] of entries) {
                if (type === vscode.FileType.File && name !== triggerFileName) {
                    const siblingUri = vscode.Uri.joinPath(parentUri, name);
                    const siblingPath = this.normalizePath(vscode.workspace.asRelativePath(siblingUri));

                    if (this.isSupportedFile(name) && !this.isExcluded(siblingPath)) {
                        if (!this.options.dirtyFiles.has(siblingPath) && !this.options.deletedFiles.has(siblingPath)) {
                            this.options.headerDirtyFiles.add(siblingPath);
                        }
                    }
                }
            }
        } catch (e) {
            console.warn(`Failed to schedule neighbourhood update`, e);
        }
    }

    public dispose(): void {
        this.watcher.dispose();
        this.renameDisposable.dispose();
    }
}