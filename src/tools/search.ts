import * as vscode from 'vscode';
import * as path from 'path';
import { getFileContent } from '../utils/workspace';
import { ToolResult, ToolSchema } from './toolIndex';
import { EmbedProvider } from '../apis/embed/embedProvider';
import { Indexer } from '../indexing/indexer';
import { excludePattern } from '../indexing/languages/_languageIndex';

export type SearchCodebaseDeps = {
    indexer: Indexer,
    embedProvider: EmbedProvider,
    model: string
}

export const searchSchemas: ToolSchema[] = [
    {
        type: "function",
        name: "glob",
        description: "Find files in the current workspace matching a glob pattern.",
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
        description: "Search for a regular expression pattern inside files.",
        parameters: {
            type: "object",
            properties: {
                query: { type: "string", description: "The regex pattern to search for."},
                filePattern: { type: "string", description: "Optional glob pattern (default: '**/*')."}
            },
            required: ["query"]
        }
    },
    {
        type: "function",
        name: "searchCodebase",
        description: "Search indexed workspace code using a hybrid of semantic meaning and exact keyword matching. For best results, include specific code identifiers, variable names, or technical terms alongside the semantic intent.",
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

        if (uris.length === 0) return { message: 'No files found in workspace' };

        return { message: uris.map(uri => path.relative(cwd, uri.fsPath)).join('\n') };
    } 

    finally {
        signal.removeEventListener('abort', abortListener);
        cancelTokenSource.dispose();
    }
};


const textDecoder = new TextDecoder('utf-8');

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
        const results: string[] = [];

        for (const uri of uris) {
            if (signal.aborted) throw new Error('AbortError');

            try {
                const content = await getFileContent(uri);
                const lines = content.split('\n');

                const relativePath = path.relative(cwd, uri.fsPath);

                for (let i = 0; i< lines.length; i++) {
                    if (regex.test(lines[i])) {
                        results.push(`${relativePath}:${i + 1}:${lines[i].trim()}`);
                    }
                }
            } catch (e) { continue; }
        }

        if (signal.aborted) throw new Error('AbortError');

        return { message: results.length > 0 ? results.slice(0, 500).join('\n') : "No matches found." };
    }

    finally {
        signal.removeEventListener('abort', abortListener);
        cancelTokenSource.dispose();
    }
};

export async function executeSearchCodebase(query: string, deps: SearchCodebaseDeps, signal: AbortSignal ): Promise<ToolResult> {
    if (signal.aborted) throw new Error('AbortError');
    if (!query.trim()) throw new Error('Search query is emtpy');
    if (!deps.indexer.indexEnabled()) throw new Error('Indexing is disabled cannot use semantic search');
    const [queryVector] = await deps.embedProvider.embed(deps.model, [query]);
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


