import * as vscode from 'vscode';
import * as path from 'path';
import { getFileContent } from '../utils/workspace';
import { ToolResult, ToolSchema } from './toolIndex';
import { EmbedProvider } from '../apis/embed/embedProvider';
import { Indexer } from '../indexing/indexer';
import { excludePattern } from '../indexing/languages/_languageIndex';
import { filterGitIgnored } from '../utils/gitignore';

export type findDeps = {
    indexer: Indexer,
    embedProvider: EmbedProvider,
    model: string
}

export const searchSchemas: ToolSchema[] = [
    {
        type: "function",
        name: "glob",
        description: "Find files in the current workspace matching a glob pattern. Use this to discover file paths before reading them.",
        parameters: {
            type: "object",
            properties: {
                pattern: { type: "string", description: "Glob pattern (e.g., 'src/**/*.ts')."}
            },
            required: ["pattern"]
        }
    },
    {
        type: "function",
        name: "grep",
        description: "Search for an exact regex pattern inside files. Use sparingly — prefer 'find' for code exploration. Only reach for grep when you need precise regex matching (e.g., finding all call sites of a specific function signature, exact string matches, import patterns) that semantic search may miss. Always pair with a narrow filePattern to limit scope.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "The regex pattern to search for. Be specific."},
                filePattern: { type: "string", description: "Glob to restrict which files are searched (e.g., 'src/**/*.ts'). Always provide this to avoid scanning the entire workspace."}
            },
            required: ["query"]
        }
    },
    {
        type: "function",
        name: "find",
        description: "Search indexed workspace code using a hybrid of semantic meaning and exact keyword matching. This is the primary code search tool — fast, indexed, and token-efficient. Use it first for exploring code, finding definitions, understanding patterns, or locating relevant implementation. For best results, include specific code identifiers, variable names, or technical terms alongside the semantic intent.",
        parameters: {
            type: "object",
            properties: {
                query: {
                    type: "string",
                    description: "A concise, keyword-rich search query. Avoid conversational sentences. Example: 'user authentication login auth' rather than 'where is the user login handled?'"
                }
            },
            required: ["query"]
        }
    }
];

export async function executeGlob(pattern: string, cwd: string, signal: AbortSignal): Promise<ToolResult> {

    const baseUri = vscode.Uri.file(cwd);
    const searchPattern = new vscode.RelativePattern(baseUri, pattern);
    const relativeExlude = new vscode.RelativePattern(baseUri, excludePattern);

    const cancelTokenSource = new vscode.CancellationTokenSource();
    const abortListener = () => cancelTokenSource.cancel();
    signal.addEventListener('abort', abortListener);

    try {
        const uris = await vscode.workspace.findFiles(searchPattern, relativeExlude, 1000, cancelTokenSource.token);

        if (signal.aborted) throw new Error('AbortError');

        // Filter out files ignored by .gitignore (git's view of the repo)
        const filteredUris = await filterGitIgnored(uris, cwd);

        if (filteredUris.length === 0) return { message: 'No files found in workspace' };

        return { message: filteredUris.map(uri => path.relative(cwd, uri.fsPath)).join('\n') };
    } 

    finally {
        signal.removeEventListener('abort', abortListener);
        cancelTokenSource.dispose();
    }
};

const MAX_RESULTS = 500;
const MAX_OUTPUT_CHARS = 50_000;

export async function executeGrep(query: string, filePattern: string = '**/*', cwd: string, signal: AbortSignal): Promise<ToolResult> {
    let regex: RegExp;
    try { regex = new RegExp(query); }
    catch(e) { throw new Error(`Invalid regex: ${e}`); } 

    const baseUri = vscode.Uri.file(cwd);
    const searchPattern = new vscode.RelativePattern(baseUri, filePattern);
    const relativeExlude = new vscode.RelativePattern(baseUri, excludePattern);

    const cancelTokenSource = new vscode.CancellationTokenSource();
    const abortListener = () => cancelTokenSource.cancel();
    signal.addEventListener('abort', abortListener);

    try {
        const uris = await vscode.workspace.findFiles(searchPattern, relativeExlude, 1000, cancelTokenSource.token);

        // Filter out files ignored by .gitignore (git's view of the repo)
        const filteredUris = await filterGitIgnored(uris, cwd);

        const results: string[] = [];
        let totalChars = 0;
        let truncated = false;

        for (const uri of filteredUris) {
            if (signal.aborted) throw new Error('AbortError');
            if (truncated) break;

            try {
                const content = await getFileContent(uri);
                const lines = content.split('\n');

                const relativePath = path.relative(cwd, uri.fsPath);

                for (let i = 0; i < lines.length; i++) {
                    if (regex.test(lines[i])) {
                        const entry = `${relativePath}:${i + 1}:${lines[i].trim()}`;
                        totalChars += entry.length + 1; // +1 for the newline when joined

                        if (results.length >= MAX_RESULTS || totalChars >= MAX_OUTPUT_CHARS) {
                            truncated = true;
                            if (totalChars >= MAX_OUTPUT_CHARS) {
                                // Don't add the overflow entry; slice back to what fits
                            } else {
                                results.push(entry);
                            }
                            break;
                        }

                        results.push(entry);
                    }
                }
            } catch (e) { continue; }
        }

        if (signal.aborted) throw new Error('AbortError');

        if (results.length === 0) {
            return { message: "No matches found." };
        }

        // Final safety: ensure we never exceed MAX_OUTPUT_CHARS even with all entries
        let output = results.join('\n');
        if (output.length > MAX_OUTPUT_CHARS) {
            // Truncate to the nearest complete line boundary
            const cutPoint = output.lastIndexOf('\n', MAX_OUTPUT_CHARS);
            output = cutPoint > 0 ? output.slice(0, cutPoint) : output.slice(0, MAX_OUTPUT_CHARS);
            truncated = true;
        }

        if (truncated) {
            output += `\n\n[Results truncated. ${results.length} matches found. Refine your search to narrow results.]`;
        }

        return { message: output };
    }

    finally {
        signal.removeEventListener('abort', abortListener);
        cancelTokenSource.dispose();
    }
};

export async function executeFind(query: string, deps: findDeps, signal: AbortSignal ): Promise<ToolResult> {
    if (signal.aborted) throw new Error('AbortError');
    if (!query.trim()) throw new Error('Search query is emtpy');
    if (!deps.indexer.indexEnabled()) throw new Error('Indexing is disabled cannot use semantic search');
    const [queryVector] = await deps.embedProvider.embed(deps.model, [query], signal);
    const results = await deps.indexer.search(query, queryVector);

    if (results.length === 0){
        return {
            message: 'No relevant code found'
        };
    }

    // TODO: add distance
    return {
        message: results.map((r, i) =>
            `Result ${i + 1}\nFile: ${r.filePath}\nLines: ${r.startLine}-${r.endLine}\n\n${r.text}`
            ).join('\n\n---\n\n')
    };
}


