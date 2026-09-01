import * as cp from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import { SessionMetadata } from '../session/agentSession';

const exec = util.promisify(cp.exec);

export type PatchStatus = 'pending' | 'conflict' | undefined;

export class WorktreeManager {
    public readonly worktreePath: string;
    private readonly statusFilePath: string;
    private patchStatus: PatchStatus = undefined;

    private emitter = new vscode.EventEmitter();
    public readonly onDidUpdateStatus = this.emitter.event;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly originalWorkspace: string,
        private readonly metadata: SessionMetadata
    ) {

        const storageBase = this.context.storageUri!.fsPath;
        const sessionDir = path.join(storageBase, 'sessions', this.metadata.id);

        this.worktreePath = path.join(sessionDir, 'worktree');
        this.statusFilePath = path.join(sessionDir, 'patch_status.txt');
    }

    public async initialize(): Promise<void> {
        try {
            const status = (await fs.readFile(this.statusFilePath, 'utf-8')).trim();
            this.patchStatus = (status === 'pending' || status === 'conflict') ? (status as PatchStatus) : undefined;
        } catch {
            this.patchStatus = undefined;
        }
    }

    public async setup(): Promise<void> {

        // check if git is installed
        const gitInstalled = await WorktreeManager.isGitInstalled();
        if (!gitInstalled) {
            vscode.window.showErrorMessage('Install Git on your system and restart VS Code.', 'Understood');
            throw new Error('Git is not installed on the system.');
        }

        // Check if workspace is a git repo
        const isRepo = await WorktreeManager.isGitRepo(this.originalWorkspace);
        if (!isRepo) {
            const userChoice = await vscode.window.showWarningMessage(
                'Git repository required for file edits. Initialize now?',
                'Initialize',
                'Cancel'
            );

            if (userChoice === 'Initialize') {
                try {
                    await WorktreeManager.initGitRepo(this.originalWorkspace);
                    vscode.window.showInformationMessage('Git repository initialized successfully.');
                } catch (e) {
                    vscode.window.showErrorMessage(`Failed to initialize Git: ${e}`);
                    throw new Error(`Failed to initialize Git: ${e}`);
                }
            } else {
                throw new Error("Agent execution cancelled. A Git repository is required.");
            }
        }

        const exists = await fs.stat(this.worktreePath).then(() => true).catch(() => false);

        // First-time session setup: create worktree, reset to HEAD, and link
        if (!exists) {
            await fs.mkdir(path.dirname(this.worktreePath), { recursive: true });
            await exec(`git worktree add --detach "${this.worktreePath}" HEAD`, { cwd: this.originalWorkspace });
            await this.reset();
        }
        // Existing work tree with no pending patch, full sync with workspace 
        else if (!this.patchStatus) {
            await this.reset();
        }
        // Active unapplied edits, only sync host files untouched by the agent
        else {
            await this.syncUntouchedDirtyFiles();
        }
        await this.link();
    }

    private async reset(): Promise<void> {
        // Get the current HEAD commit SHA of the main workspace
        const { stdout: headSha } = await exec(`git rev-parse HEAD`, { cwd: this.originalWorkspace });

        // Hard reset the worktree to match the main workspace's commit
        await exec(`git reset --hard ${headSha.trim()}`, { cwd: this.worktreePath });

        // Clean any untracked files left over from previous agent runs
        await exec(`git clean -fd`, { cwd: this.worktreePath });

        await this.syncDirtyFiles();
    }

    private async link(): Promise<void> {
        const DEP_DIR_NAMES = new Set([
            'node_modules', '.pnpm-store', '.yarn', 'bower_components', 'jspm_packages',
            '.venv', 'venv', 'env', '.tox', '.nox', '__pypackages__',
            '.cargo', 'vendor', '.bundle', 'Pods', 'Carthage', '.swiftpm',
            '.pub-cache', '.dart_tool', 'deps', 'packages', '.gradle', 'Library'
        ]);

        const BUILD_CACHE_NAMES = new Set([
            'dist', 'build', 'out', 'output', '.output', '.next', '.nuxt', '.turbo',
            '.cache', '.parcel-cache', '.svelte-kit', '.astro', '.docusaurus', '.vite',
            '.vercel', '.netlify', 'storybook-static', '__pycache__', '.pytest_cache',
            '.mypy_cache', '.ruff_cache', '.coverage', 'htmlcov', '.hypothesis',
            'target', 'cmake-build-debug', 'cmake-build-release', 'CMakeFiles',
            '.ninja_deps', '_build', 'bin', 'obj', 'TestResults', '.vs',
            'DerivedData', '.build', 'coverage', '.nyc_output', '.nx'
        ]);

        const CONFIG_FILE_PATTERN = /(^|[\\/])(\.env(\..+)?|tsconfig\.tsbuildinfo|local\.settings\.json|appsettings\.Development\.json|\.envrc)$/i;

        try {
            const { stdout } = await exec(`git status --ignored=matching --porcelain`, { cwd: this.originalWorkspace });
            const ignoredEntries = stdout
                .split('\n')
                .filter(line => line.startsWith('!! '))
                .map(line => {
                    let p = line.substring(3).trim();
                    if (p.startsWith('"') && p.endsWith('"')) {
                        p = p.slice(1, -1);
                    }
                    return p;
                });

            const symlinkedRoots: string[] = [];

            for (const relativePath of ignoredEntries) {
                const normalizedPath = relativePath.replace(/\\/g, '/').replace(/\/$/, '');
                const segments = normalizedPath.split('/');
                const baseName = segments[segments.length - 1];

                if (symlinkedRoots.some(root => normalizedPath.startsWith(root + '/'))) {
                    continue;
                }

                const src = path.join(this.originalWorkspace, normalizedPath);
                const dest = path.join(this.worktreePath, normalizedPath);

                let srcStat;
                try {
                    srcStat = await fs.stat(src);
                } catch {
                    continue;
                }

                // Tier 1: Heavy Dependencies
                if (srcStat.isDirectory() && DEP_DIR_NAMES.has(baseName)) {
                    if (segments.some(seg => BUILD_CACHE_NAMES.has(seg))) {
                        continue;
                    }

                    let destLstat;
                    try {
                        destLstat = await fs.lstat(dest);
                    } catch {
                        destLstat = null;
                    }

                    // If dest is already a real directory created by the agent, preserve it
                    if (destLstat && destLstat.isDirectory() && !destLstat.isSymbolicLink()) {
                        continue;
                    }

                    // If dest is already a valid symlink, skip
                    if (destLstat && destLstat.isSymbolicLink()) {
                        try {
                            const currentTarget = await fs.readlink(dest);
                            if (path.resolve(path.dirname(dest), currentTarget) === path.resolve(src)) {
                                symlinkedRoots.push(normalizedPath);
                                continue;
                            }
                        } catch { }
                    }

                    // Create or repair symlink
                    await fs.mkdir(path.dirname(dest), { recursive: true });
                    await fs.rm(dest, { recursive: true, force: true }).catch(() => { });

                    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
                    await fs.symlink(src, dest, symlinkType);
                    symlinkedRoots.push(normalizedPath);
                }

                // Tier 2: Build Caches -> Skip
                else if (srcStat.isDirectory() && BUILD_CACHE_NAMES.has(baseName)) {
                    continue;
                }

                // Tier 3: Configs / Env Files -> Copy only if missing or outdated
                else if (srcStat.isFile() && CONFIG_FILE_PATTERN.test(normalizedPath)) {
                    let destStat;
                    try {
                        destStat = await fs.stat(dest);
                    } catch {
                        destStat = null;
                    }

                    if (!destStat || srcStat.mtimeMs > destStat.mtimeMs) {
                        await fs.mkdir(path.dirname(dest), { recursive: true });
                        await fs.copyFile(src, dest);
                    }
                }
            }
        } catch (e) {
            console.warn(`WorktreeManager: Failed to reconcile dependencies: ${e}`);
        }
    }

    private async syncDirtyFiles(): Promise<void> {

        const { stdout } = await exec(`git status --porcelain`, { cwd: this.originalWorkspace });
        const dirtyFiles = stdout.split('\n')
            .filter(line => line.match(/^[MARC] |^[ MARC][MD] |^\?\? /)) // matches modified, added and untracked files
            .map(line => {
                let filePath = line.substring(3).trim();
                // Remove surrounding quotes if Git added them
                if (filePath.startsWith('"') && filePath.endsWith('"')) {
                    filePath = filePath.slice(1, -1);
                }
                return filePath;
            });

        // copy these files to the worktree 
        for (const file of dirtyFiles) {
            const src = vscode.Uri.file(path.join(this.originalWorkspace, file));
            const dest = vscode.Uri.file(path.join(this.worktreePath, file));
            try {
                // Check if the file actually exists (it might be a deleted dirty file)
                await vscode.workspace.fs.stat(src);
                await vscode.workspace.fs.copy(src, dest, { overwrite: true });
            } catch {
                // If it was deleted in the main workspace, delete it in the worktree too
                try {
                    await vscode.workspace.fs.delete(dest, { useTrash: false });
                } catch (e) { }
            }
        }

        // Stage baseline and create a local temporary checkpoint commit
        await exec(`git add -A`, { cwd: this.worktreePath });
        await exec(
            `git -c user.name="Agent" -c user.email="agent@local" commit --allow-empty -m "baseline"`,
            { cwd: this.worktreePath }
        );
    }

    private async syncUntouchedDirtyFiles(): Promise<void> {
        try {
            // 1. Files modified/created by the agent in this worktree
            const { stdout: agentDiff } = await exec(`git diff --name-only HEAD`, { cwd: this.worktreePath });
            const agentModifiedFiles = new Set(agentDiff.split('\n').map(f => f.trim()).filter(Boolean));

            // 2. Dirty/untracked files in the user's host workspace
            const { stdout: hostStatus } = await exec(`git status --porcelain`, { cwd: this.originalWorkspace });
            const hostDirtyFiles = hostStatus
                .split('\n')
                .filter(line => line.match(/^[MARC] |^[ MARC][MD] |^\?\? /))
                .map(line => {
                    let filePath = line.substring(3).trim();
                    if (filePath.startsWith('"') && filePath.endsWith('"')) {
                        filePath = filePath.slice(1, -1);
                    }
                    return filePath;
                });

            const syncedFiles: string[] = [];

            for (const file of hostDirtyFiles) {
                // Do not overwrite files the agent is actively editing
                if (agentModifiedFiles.has(file)) continue;

                const src = vscode.Uri.file(path.join(this.originalWorkspace, file));
                const dest = vscode.Uri.file(path.join(this.worktreePath, file));

                try {
                    await vscode.workspace.fs.stat(src);
                    await vscode.workspace.fs.copy(src, dest, { overwrite: true });
                    syncedFiles.push(file);
                } catch {
                    try {
                        await vscode.workspace.fs.delete(dest, { useTrash: false });
                        syncedFiles.push(file);
                    } catch { }
                }
            }

            // 3. Absorb host changes into the worktree's HEAD baseline
            if (syncedFiles.length > 0) {
                // Stage ONLY the synced files so agent edits remain unstaged deltas
                for (const file of syncedFiles) {
                    await exec(`git add -A -- "${file}"`, { cwd: this.worktreePath }).catch(() => { });
                }
                await exec(
                    `git -c user.name="Agent" -c user.email="agent@local" commit --allow-empty -m "sync host changes"`,
                    { cwd: this.worktreePath }
                );
            }
        } catch (e) {
            console.warn(`WorktreeManager: Failed to sync untouched dirty files: ${e}`);
        }
    }

    private async addGitExclude(entry: string): Promise<void> {
        try {
            const { stdout: excludeRelative } = await exec(`git rev-parse --git-path info/exclude`, { cwd: this.worktreePath });
            const excludePath = path.resolve(this.worktreePath, excludeRelative.trim());
            await fs.mkdir(path.dirname(excludePath), { recursive: true });

            const content = await fs.readFile(excludePath, 'utf-8').catch(() => '');
            const lines = new Set(content.split('\n').map(l => l.trim()).filter(Boolean));

            const clean = entry.replace(/\/$/, '');
            // Exclude both the bare symlink file and the directory path
            lines.add(clean);
            lines.add(`${clean}/`);

            await fs.writeFile(excludePath, Array.from(lines).join('\n') + '\n', 'utf-8');
        } catch (e) {
            console.warn(`WorktreeManager: Failed to write git exclude: ${e}`);
        }
    }

    // Persist patch status if the user didn't take action during a reload
    private async setPatchStatus(status: PatchStatus): Promise<void> {
        this.patchStatus = status;
        try {
            if (status) {
                await fs.mkdir(path.dirname(this.statusFilePath), { recursive: true });
                await fs.writeFile(this.statusFilePath, status, 'utf-8');
            } else {
                await fs.unlink(this.statusFilePath).catch(() => { });
            }
        } catch {
            // Ignore if file doesn't exist
        }
    }

    // Get the diff between agent worktree and the user's original workspace
    private async getPatch(): Promise<string> {

        try { await fs.stat(this.worktreePath); }
        catch { return ''; }

        // Find untracked items and dynamically exclude any that are symlinks
        const { stdout: status } = await exec(`git status --porcelain`, { cwd: this.worktreePath });
        const untracked = status
            .split('\n')
            .filter(line => line.startsWith('?? '))
            .map(line => line.substring(3).trim().replace(/^"|"$/g, ''));

        for (const item of untracked) {
            try {
                const itemPath = path.join(this.worktreePath, item);
                const stat = await fs.lstat(itemPath);
                if (stat.isSymbolicLink()) {
                    await this.addGitExclude(item);
                }
            } catch { }
        }

        // Track new files
        await exec(`git add -N .`, { cwd: this.worktreePath });

        // Diff everything against the baseline commit regardless of what the agent staged
        const { stdout: patch } = await exec(`git diff HEAD --binary`, { cwd: this.worktreePath });
        return patch;
    }

    // Display a patch ui to the frontend
    public async displayPatch(): Promise<void> {
        const patchContent = await this.getPatch();
        if (!patchContent.trim()) return;

        this.emitter.fire({ type: 'reviewPatch', patch: patchContent });

        // Preserve existing conflict state on reload; otherwise mark as pending
        if (this.patchStatus === 'conflict') {
            this.emitter.fire({ type: 'updatePatchStatus', status: 'conflict' });
        } else {
            await this.setPatchStatus('pending');
        }
    }

    public async applyPatch(): Promise<void> {
        const patchContent = await this.getPatch();
        if (!patchContent.trim()) return;

        // Write patch to temp file in main workspace
        const patchPath = path.join(path.dirname(this.statusFilePath), `run.patch`);
        await fs.writeFile(patchPath, patchContent, 'utf-8');

        try {
            // Register untracked files in the main workspace
            await exec(`git add -A`, { cwd: this.originalWorkspace });
            // apply patch
            await exec(`git apply --3way --ignore-whitespace "${patchPath}"`, { cwd: this.originalWorkspace });

            await this.reset();
            await this.setPatchStatus(undefined);

            this.emitter.fire({ type: 'updatePatchStatus', status: 'accepted' });
        }
        catch (e: any) {
            // Check if any of these outputs have 'with conflicts' to catch merge conflicts
            const errorStr = (e.stdout || '') + (e.stderr || '') + (e.message || '');
            console.log(errorStr);

            // Merge conflict, notify the UI and wait for it to be resolved
            if (errorStr.includes('with conflicts')) {
                await this.setPatchStatus('conflict');
                this.emitter.fire({ type: 'updatePatchStatus', status: 'conflict' });
                throw new Error('MERGE_CONFLICT');
            }
            throw e;
        }

        finally {
            // ignore clean up errors
            await fs.unlink(patchPath).catch(() => { });
        }
    }

    // This option is available for merge conflicts
    // It will overwrite all files in the original workspace with the agent worktree's version
    public async forceApply(): Promise<void> {
        await exec(`git add -N .`, { cwd: this.worktreePath });

        // Get all files modified or created by agent
        const { stdout } = await exec(`git diff --name-only HEAD`, { cwd: this.worktreePath });
        const files = stdout.split('\n').map(f => f.trim()).filter(f => f.length > 0);

        for (const file of files) {
            const src = vscode.Uri.file(path.join(this.worktreePath, file));
            const dest = vscode.Uri.file(path.join(this.originalWorkspace, file));

            try {
                // Overwrite file in the main workspace
                await vscode.workspace.fs.stat(src);
                await vscode.workspace.fs.copy(src, dest, { overwrite: true });
            } catch {
                // If fs.stat fails the agent deleted the file in the worktree
                // Delete in the main workspace as well
                try {
                    await vscode.workspace.fs.delete(dest, { useTrash: false });
                } catch (e) { }
            }
        }
        await this.reset();
        await this.setPatchStatus(undefined);
        this.emitter.fire({ type: 'updatePatchStatus', status: 'accepted' });
    }

    public async rejectPatch(): Promise<void> {
        await this.reset();
        await this.setPatchStatus(undefined);
        this.emitter.fire({ type: 'updatePatchStatus', status: 'rejected' });
    }

    public async resolveConflicts(): Promise<void> {
        await this.reset();
        await this.setPatchStatus(undefined);
        this.emitter.fire({ type: 'updatePatchStatus', status: 'accepted' });
    }

    // Git utils
    public static async isGitInstalled(): Promise<boolean> {
        try {
            await exec(`git --version`);
            return true;
        } catch {
            return false;
        }
    }

    public static async isGitRepo(workspacePath: string): Promise<boolean> {
        try {
            await exec(`git rev-parse --is-inside-work-tree`, { cwd: workspacePath });
            return true;
        } catch {
            return false;
        }
    }

    public static async initGitRepo(workspacePath: string): Promise<void> {
        await exec(`git init`, { cwd: workspacePath });
        await exec(`git add .`, { cwd: workspacePath });
        try {
            // try with user's git config if it's set up
            await exec(`git commit --allow-empty -m "Initial commit"`, { cwd: workspacePath });
        } catch (e) {
            // use dummy credentials if we don't have a git config
            await exec(
                `git -c user.name="Agent Harness" -c user.email="agent@harness.local" commit --allow-empty -m "Initial commit"`,
                { cwd: workspacePath }
            );
        }
    }

    public async cleanup(): Promise<void> {
        try {
            await this.setPatchStatus(undefined);
            await exec(`git worktree remove "${this.worktreePath}" --force`, { cwd: this.originalWorkspace });
        } catch {
            await exec(`git worktree prune`, { cwd: this.originalWorkspace }).catch(() => { });
        }
    }
}