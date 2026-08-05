import * as vscode from 'vscode';
import * as path from 'path';
import { getFileContent } from '../utils/workspace';
import { ToolResult, ToolSchema } from './toolIndex';
import { EmbedProvider } from '../apis/embed/embedProvider';
import { Indexer } from '../indexing/indexer';
import { excludePattern } from '../indexing/languages/_languageIndex';
import { filterGitIgnored } from '../utils/gitignore';
import { spawn } from 'child_process';
import { rgPath } from '@vscode/ripgrep';
import * as readline from 'readline';

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

const MAX_RESULTS = 100;
const MAX_ENTRY_CHARS = 1_000;
const MAX_OUTPUT_CHARS = 25_000;

export async function executeGrep(query: string, filePattern: string, cwd: string, signal: AbortSignal): Promise<ToolResult> {
    try { new RegExp(query); } 
    catch (e) { throw new Error(`Invalid regex: ${String(e)}`);}

    return new Promise((resolve, reject) => {

        const args = [
            '--json',
            '--line-number',
            '--glob', filePattern,
            '--glob', `!${excludePattern}`,
            '-e', query,
            '.'
        ];

        const child = spawn(rgPath, args, { cwd });

        const results: string[] = [];
        let totalChars = 0;
        let truncated = false;

        const abortListener = () => {
            child.kill();
            reject(new Error('AbortError'));
        };
        signal.addEventListener('abort', abortListener);

        const rl = readline.createInterface({
            input: child.stdout,
            crlfDelay: Infinity
        });

        rl.on('line', (line) => {
            if (truncated) return;

            try {
                const parsed = JSON.parse('line');

                if (parsed.type === 'match') {
                    const filePath = parsed.data.path.text;
                    const lineNumber = parsed.data.lineNumber;
                    const lineText = (parsed.data.lines.text || '').replace(/\r?\n$/, '').trim();
    
                    const entry = `${filePath}:${lineNumber}:${lineText}`;
    
                    if (entry.length > MAX_ENTRY_CHARS) return;
    
                    totalChars += entry.length + 1;
    
                    if (results.length >= MAX_RESULTS || totalChars >= MAX_OUTPUT_CHARS) {
                        truncated = true;
                        child.kill();
                        return;
                    }

                    results.push(entry);
                }
            } catch (e) {
            }
        });

        child.on('error', (e) => {
            signal.removeEventListener('abort', abortListener);
            reject(e);
        });

        child.on('close', () => {
            signal.removeEventListener('abort', abortListener);

            if (signal.aborted) return reject(new Error('AbortListener'));

            if (results.length === 0) return resolve({ message: 'No matches found.' });

            let output = results.join('\n');

            if (output.length > MAX_OUTPUT_CHARS) {
                const cutPoint = output.lastIndexOf('\n', MAX_OUTPUT_CHARS);
                output = cutPoint > 0 ? output.slice(0, cutPoint) : output.slice(0, MAX_OUTPUT_CHARS);
                truncated = true;
            }

            if (truncated) {
                output = `[Results truncated. ${results.length} matches found. Refine your search to narrow results.]\n\n${output}`;
            }

            resolve({ message: output });
        });
    });
}

export async function executeFind(query: string, deps: findDeps, signal: AbortSignal ): Promise<ToolResult> {
    if (signal.aborted) throw new Error('AbortError');
    if (!query.trim()) throw new Error('Search query is emtpy');

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


