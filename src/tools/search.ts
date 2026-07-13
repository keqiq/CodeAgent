import * as vscode from 'vscode';
import { getFileContent } from '../utils/workspace';
import { ToolResult, ToolSchema } from './toolIndex';
import { EmbedProvider } from '../apis/embed/embedProvider';
import { Indexer } from '../indexing/indexer';

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

export async function executeGlob(pattern: string): Promise<ToolResult> {
    const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**}';
    const uris = await vscode.workspace.findFiles(pattern, excludePattern, 1000);

    if (uris.length === 0) {
        return {
            message: 'No files found in workspace'
        };
    }

    return {
        message: uris.map(uri => vscode.workspace.asRelativePath(uri)).join('\n')
    };
};


const textDecoder = new TextDecoder('utf-8');

export async function executeGrep(query: string, filePattern: string = '**/*'): Promise<ToolResult> {
    let regex: RegExp;
    try { regex = new RegExp(query); }
    catch(e) { 
        throw new Error(`Invalid regex: ${e}`);
    }

    const excludePattern = '{**/node_modules/**,**/.git/**,**/dist/**,**/*.{png,jpg,jpeg,ico,bin}}';
    const uris = await vscode.workspace.findFiles(filePattern, excludePattern, 1000);
    const results: string[] = [];

    for (const uri of uris) {
        try {
            const content = await getFileContent(uri);
            const lines = content.split('\n');

            for (let i = 0; i < lines.length; i++) {
                if (regex.test(lines[i])) {
                    results.push(`${vscode.workspace.asRelativePath(uri)}:${i + 1}:${lines[i].trim()}`);
                }
            };
        } catch(e) { continue; }

    }
    return {
        message: results.length > 0 ? results.slice(0, 500).join('\n') : "No matches found." 
    };
};

export async function executeSearchCodebase(query: string, deps: SearchCodebaseDeps ): Promise<ToolResult> {
    if (!query.trim()) throw new Error('Search query is emtpy');
    if (!deps.indexer.indexEnabled()) throw new Error('Indexing is disabled cannot use semantic search');
    const [queryVector] = await deps.embedProvider.embed(deps.model, [query]);
    const results = await deps.indexer.search(query, queryVector);

    // console.log(`[SEARCH DEBUG] Query: ${query}`);
    // console.log(`[SEARCH DEBUG] Result count: ${results.length}`);

    if (results.length === 0){
        return {
            message: 'No relevant code found'
        };
    }

    // for (const r of results.slice(0, 5)) {
    //     console.log(`[SEARCH DEBUG] ${r.filePath}:${r.startLine}-${r.endLine}`);
    //     console.log(`[SEARCH DEBUG] preview: ${String(r.text).slice(0, 160).replace(/\s+/g, ' ')}`);
    // }

    // TODO: add distance
    return {
        message: results.map((r, i) =>
            `Result ${i + 1}\nFile: ${r.filePath}\nLines: ${r.startLine}-${r.endLine}\n\n${r.text}`
            ).join('\n\n---\n\n')
    };
}


