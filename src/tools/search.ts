import * as vscode from 'vscode';
import * as path from 'path';
import { ToolResult, ToolSchema } from './toolIndex';
import { EmbedProvider } from '../apis/embed/embedProvider';
import { Indexer } from '../indexing/indexer';
import { excludePattern } from '../indexing/languages/_languageIndex';
import { spawn } from 'child_process';
import * as readline from 'readline';
import * as fs from 'fs';

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
                pattern: { type: "string", description: "Glob pattern (e.g., 'src/**/*.ts')." }
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
                query: { type: "string", description: "The regex pattern to search for. Be specific." },
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
    },
    {
        type: "function",
        name: "refs",
        description: "Find all references of a variable or function across the workspace. Provide the file path, the line number it is on, and the exact symbol name.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "The relative path to the file." },
                line: { type: "number", description: "The 1-based line number." },
                symbol: { type: "string", description: "The exact name of the variable/function (e.g., 'validateUser')." }
            },
            required: ["filePath", "line", "symbol"]
        }
    }
];

export function getRipgrepPath(): string {
    const isWin = process.platform === 'win32';
    const rgExe = isWin ? 'rg.exe' : 'rg';

    const possiblePaths = [
        path.join(vscode.env.appRoot, 'node_modules.asar.unpacked', '@vscode', 'ripgrep', 'bin', rgExe),
        path.join(vscode.env.appRoot, 'node_modules', '@vscode', 'ripgrep', 'bin', rgExe),
        path.join(vscode.env.appRoot, 'node_modules.asar.unpacked', 'vscode-ripgrep', 'bin', rgExe),
    ];

    for (const p of possiblePaths) {
        if (fs.existsSync(p)) {
            return p;
        }
    }

    return 'rg';
}

const rgPath = getRipgrepPath();

const MAX_FILES = 100;

export function executeGlob(pattern: string, cwd: string, signal: AbortSignal): Promise<ToolResult> {
    return new Promise((resolve, reject) => {
        const args = [
            '--files',
            '--glob', pattern,
            '--glob', `!${excludePattern}`,
            '.'
        ];

        const child = spawn(rgPath, args, { cwd });

        const results: string[] = [];
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

            const entry = line.trim();
            if (entry) {
                if (results.length >= MAX_FILES) {
                    truncated = true;
                    child.kill();
                    return;
                }

                results.push(entry);
            }
        });

        child.on('error', (e) => {
            signal.removeEventListener('abort', abortListener);
            reject(e);
        });

        child.on('close', () => {
            signal.removeEventListener('abort', abortListener);

            if (signal.aborted) return reject(new Error('AbortError'));

            if (results.length === 0) return resolve({ message: 'No files found in workspace.' });

            let output = results.join('\n');

            if (truncated) {
                output = `[Results truncated. ${results.length} files found. Refine your search pattern to narrow results.]\n\n${output}`;
            }

            resolve({ message: output });
        });
    });
}

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
                const parsed = JSON.parse(line);

                if (parsed.type === 'match') {
                    const filePath = parsed.data.path.text;
                    const lineNumber = parsed.data.line_number;
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

            if (signal.aborted) return reject(new Error('AbortError'));

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

const MAX_REFS = 500;

export async function executeRefs(filePath: string, line: number, symbol: string, cwd: string): Promise<ToolResult> {
    const uri = vscode.Uri.file(path.join(cwd, filePath));

    try {
        const document = await vscode.workspace.openTextDocument(uri);

        if (line < 1 || line > document.lineCount) {
            return { message: `Error: Line ${line} is out of bounds. File only has ${document.lineCount} lines.` };
        }

        const lineText = document.lineAt(line - 1).text;

        const characterIndex = lineText.indexOf(symbol);

        if (characterIndex === -1) return { message: `Could not find symbol ${symbol} on line ${line} in ${filePath}` };

        const position = new vscode.Position(line - 1, characterIndex);

        const locations = await vscode.commands.executeCommand<vscode.Location[]>(
            'vscode.executeReferenceProvider',
            uri,
            position
        );

        const totalRefs = locations.length;
        if (totalRefs === 0) {
            return { 
                message: 'No references found for this symbol. ' +
                        '(Note: If you just created or heavily modified this file, ' +
                        'the workspace language server may still be indexing. ' +
                        'Wait a moment and try again, or use grep as a fallback.' +
                        'Or the langauage server is not running.)'
            };
        }

        const slicedLocations = locations.slice(0, MAX_REFS);

        const results = slicedLocations.map(loc => {
            const relativePath = path.relative(cwd, loc.uri.fsPath);
            const startLine = loc.range.start.line + 1;
            const startChar = loc.range.start.character + 1;
            return `${relativePath} - Row:${startLine} Col:${startChar}`;
        });

        if (totalRefs > MAX_REFS) {
            return { message: `[Results truncated. ${totalRefs} references found.]\n\n${results.join('\n')}` };
        }

        return { message: results.join('\n') };
    } catch (e) {
        return { message: `Failed to find references: ${String(e)}` };
    }
}
