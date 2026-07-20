import * as cp from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as vscode from 'vscode';
import * as fs from 'fs/promises';

const exec = util.promisify(cp.exec);

export class WorktreeManager {
    public readonly worktreePath: string;
    private readonly originalWorkspace: string;

    constructor(workspacePath: string, runID: string) {
        this.originalWorkspace = workspacePath;
        this.worktreePath = path.join(workspacePath, '..', `.agent-worktree-${runID}`);
    }

    public async setup(): Promise<void> {
        // Create the worktree linked to the current HEAD
        await exec(`git worktree add --detach "${this.worktreePath}" HEAD`, { cwd: this.originalWorkspace });

        // Sync uncommitted changes
        await this.syncDirtyFiles();
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

    public async getPatch(): Promise<string> {
        // Track new files
        await exec(`git add -N .`, { cwd: this.worktreePath });
        // get patch string
        const { stdout: patch } = await exec(`git diff`, { cwd: this.worktreePath });
        return patch;
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
        }

        catch (e: any) {
            // Check if any of these outputs have 'with conflicts' to catch merge conflicts
            const errorStr = (e.stdout || '') + (e.stderr || '') + (e.message || '');
            console.log(errorStr);

            if (errorStr.includes('with conflicts')) throw new Error('MERGE_CONFLICT');
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
    }

    public async cleanup(): Promise<void> {
        await exec(`git worktree remove "${this.worktreePath}" --force`, { cwd: this.originalWorkspace });
    }
}