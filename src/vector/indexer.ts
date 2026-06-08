import * as vscode from 'vscode';
import * as Parser from 'web-tree-sitter';

export interface CodeChunk {
    text: string;
    filePath: string;
    startLine: number;
    endLine: number;
    type: string;
}

export class CodeIndexer {
    private parser: Parser;

    private constructor () {}

    static async create(extensionUri: vscode.Uri): Promise<CodeIndexer> {
        const indexer = new CodeIndexer();

        await 
    }
}