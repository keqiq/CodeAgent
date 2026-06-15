import * as vscode from 'vscode';
import { getFileContent } from '../utils/workspace';
import { ToolSchema } from '.';

export const searchSchemas: ToolSchema[] = [
    {
        type: "function",
        function: {
            name: "glob",
            description: "Find files in the current workspace matching a glob pattern.",
            parameters: {
                type: "object",
                properties: {
                    pattern: { type: "string", description: "Glob pattern (e.g., 'src/**/*.ts')."}
                },
                required: ["pattern"]
            }
        }
    },
    {
        type: "function",
        function: {
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
        }
    }

];

export async function executeGlob(pattern: string): Promise<string> {
    const exludePattern = '{**/node_modules/**,**/.git/**,**/dist/**}';
    const uris = await vscode.workspace.findFiles(pattern, exludePattern, 1000);

    if (uris.length === 0) return "No files found.";
    return uris.map(uri => vscode.workspace.asRelativePath(uri)).join('\n');
};


const textDecoder = new TextDecoder('utf-8');

export async function executeGrep(query: string, filePattern: string = '**/*'): Promise<string> {
    let regex: RegExp;
    try { regex = new RegExp(query); }
    catch(e) { return `Error: Invalid regex : ${e}`;}

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
    return results.length > 0 ? results.slice(0, 500).join('\n') : "No matches found.";
    
};


