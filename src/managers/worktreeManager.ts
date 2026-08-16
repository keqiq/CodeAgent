import * as cp from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';

const exec = util.promisify(cp.exec);

export class WorktreeManager {
    public readonly worktreePath: string;
    private readonly originalWorkspace: string;

    private emitter = new vscode.EventEmitter();
    public readonly onDidUpdateStatus = this.emitter.event;

    constructor(private context: vscode.ExtensionContext, workspacePath: string) {
        this.originalWorkspace = workspacePath;
        this.worktreePath = path.join(workspacePath, '..', '.agent-worktree');
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

        if (!exists) {
            // Only create the worktree and link heavy deps if it doesn't exist
            await exec(`git worktree add --detach "${this.worktreePath}" HEAD`, { cwd: this.originalWorkspace });
            await this.link();
        }

        await this.reset();
    }

    public async reset(): Promise<void> {
        // Get the current HEAD commit SHA of the main workspace
        const { stdout: headSha } = await exec(`git rev-parse HEAD`, { cwd: this.originalWorkspace });
        
        // Hard reset the worktree to match the main workspace's commit
        await exec(`git reset --hard ${headSha.trim()}`, { cwd: this.worktreePath });
        
        // Clean any untracked files left over from previous agent runs
        await exec(`git clean -fd`, { cwd: this.worktreePath });

        // Sync uncommitted dirty files from the user
        await this.syncDirtyFiles();
        await this.clearState();
    }

    private async link(): Promise<void> {
        const symlinkDirs = [
            'node_modules',
            '.venv',
            'venv',
            'vendor',
            'target',
            'build',
            '.next',
            'dist',
            '.cargo'
        ];

        for (const dir of symlinkDirs) {
            const src = path.join(this.originalWorkspace, dir);
            const dest = path.join(this.worktreePath, dir);
            
            try {
                const stat = await fs.stat(src);
                if (stat.isDirectory()) {
                    const symlinkType = process.platform === 'win32' ? 'junction' : 'dir';
                    await fs.symlink(src, dest, symlinkType);
                }
            } catch {
                // Folder doesn't exist in original workspace skip
            }
        }

        const configs = [
            '.env',
            '.env.local',
            '.env.development',
            '.env.test',
            'tsconfig.json',
            'tsconfig.tsbuildinfo'
        ];

        for (const file of configs) {
            const src = path.join(this.originalWorkspace, file);
            const dest = path.join(this.worktreePath, file);

            try {
                await fs.copyFile(src, dest);
            } catch {
                // File doesn't exit in original workspace skip
            }
        }
    } 

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
                } catch (e) {}
            }
        }

        await exec(`git add -A`, { cwd: this.worktreePath });
    }

    private async getPatch(): Promise<string> {

        try {
            await fs.stat(this.worktreePath);
        } catch {
            return '';
        }

        // Track new files
        await exec(`git add -N .`, { cwd: this.worktreePath });
        // get patch string
        const { stdout: patch } = await exec(`git diff --binary`, { cwd: this.worktreePath });
        return patch;
    }

    public async displayPatch(): Promise<void> {
        const patchContent = await this.getPatch();
        if (!patchContent.trim()) return;
        
        this.emitter.fire({ type: 'reviewPatch', patch: patchContent });
        const currentStatus = this.context.workspaceState.get<string>('patchStatus');
        if (currentStatus) this.emitter.fire({ type: 'updatePatchStatus', status: currentStatus });
    }

    public async applyPatch(): Promise<void> {
        const patchContent = await this.getPatch();
        if (!patchContent.trim()) return;

        // Write patch to temp file in main workspace
        const patchPath = path.join(this.originalWorkspace, '.agent-run.patch');
        await fs.writeFile(patchPath, patchContent, 'utf-8');

        try {
            // Register untracked files in the main workspace
            await exec(`git add -A`, { cwd: this.originalWorkspace });
            // apply patch
            await exec(`git apply --3way --ignore-whitespace "${patchPath}"`, { cwd: this.originalWorkspace });
            await this.context.workspaceState.update('patchStatus', 'accepted');
            await this.reset();
            this.emitter.fire({ type: 'updatePatchStatus', status: 'accepted' });
        }
        catch (e: any) {
            // Check if any of these outputs have 'with conflicts' to catch merge conflicts
            const errorStr = (e.stdout || '') + (e.stderr || '') + (e.message || '');
            console.log(errorStr);

            if (errorStr.includes('with conflicts')) {
                await this.context.workspaceState.update('patchStatus', 'conflict');
                this.emitter.fire({ type: 'updatePatchStatus', status: 'conflict' });
                throw new Error('MERGE_CONFLICT');
            }
            throw e;
        } 

        finally {
            // ignore clean up errors
            await fs.unlink(patchPath).catch(() => {}); 
        }

    }

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
                } catch (e) {}
            } 
        }
        await this.context.workspaceState.update('patchStatus', 'accepted');
        await this.reset();
        this.emitter.fire({ type: 'updatePatchStatus', status: 'accepted' });
    }

    public async rejectPatch(): Promise<void> {
        await this.reset();
        this.emitter.fire({ type: 'updatePatchStatus', status: 'rejected' });
    }
    
    public async resolveConflicts(): Promise<void> {
        await this.reset();
        await this.context.workspaceState.update('patchStatus', 'accepted');
        this.emitter.fire({ type: 'updatePatchStatus', status: 'accepted' });
    }
    
    private async clearState(): Promise<void> {
        await this.context.workspaceState.update('patchStatus', undefined);
    }
    
    public async cleanup(): Promise<void> {
        try {
            await this.clearState();
            await exec(`git worktree remove "${this.worktreePath}" --force`, { cwd: this.originalWorkspace });
        } catch {
            // Ignore if it's already gone
        }
    }
}