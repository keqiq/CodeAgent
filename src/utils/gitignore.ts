import * as cp from 'child_process';
import * as util from 'util';
import * as path from 'path';
import * as vscode from 'vscode';

const exec = util.promisify(cp.exec);

/**
 * Cached set of git-tracked (and untracked-but-not-ignored) file paths,
 * relative to the git root. Populated once per workspace and reused.
 */
let cachedFiles: Set<string> | null = null;
let cachedCwd: string | null = null;

/**
 * Returns a Set of all file paths (relative to cwd) that git cares about —
 * i.e. tracked files plus untracked files that are NOT gitignored.
 *
 * Uses `git ls-files --cached --others --exclude-standard` so it naturally
 * respects .gitignore at every level, .git/info/exclude, and global gitignore.
 */
export async function getGitFiles(cwd: string): Promise<Set<string>> {
    if (cachedFiles && cachedCwd === cwd) {
        return cachedFiles;
    }

    try {
        const { stdout } = await exec(
            'git ls-files --cached --others --exclude-standard -z',
            { cwd, maxBuffer: 50 * 1024 * 1024 }
        );

        const files = new Set<string>();
        // -z gives us null-byte separated paths
        for (const file of stdout.split('\0')) {
            const trimmed = file.trim();
            if (trimmed.length > 0) {
                files.add(trimmed);
            }
        }

        cachedFiles = files;
        cachedCwd = cwd;
        return files;
    } catch {
        // If git fails for any reason (not a repo, git not installed, etc.),
        // return null to signal "don't filter"
        return new Set();
    }
}

/**
 * Clears the cached git file list. Call this when the workspace state changes
 * (e.g. after an agent run that may have created/deleted files).
 */
export function clearGitFilesCache(): void {
    cachedFiles = null;
    cachedCwd = null;
}

/**
 * Filters an array of vscode.Uri to only those that appear in git's
 * view of the repository. If the git file set is empty (git not available),
 * all URIs pass through unfiltered.
 */
export async function filterGitIgnored(uris: vscode.Uri[], cwd: string): Promise<vscode.Uri[]> {
    const gitFiles = await getGitFiles(cwd);

    // Empty set means git isn't available — don't filter anything
    if (gitFiles.size === 0) {
        return uris;
    }

    return uris.filter(uri => {
        const relativePath = path.relative(cwd, uri.fsPath);
        return gitFiles.has(relativePath);
    });
}
