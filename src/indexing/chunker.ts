import * as vscode from 'vscode';
import { Language, Parser, Node } from 'web-tree-sitter';
import { getFileContent } from '../utils/workspace';

export interface CodeChunk {
    text: string;
    filePath: string;
    startLine: number;
    endLine: number;
    type: string;
}

export class CodeChunker {
    private readonly languageCache = new Map<string, Language>();

    private readonly languageConfigs = new Map<string, string>([
        [".ts", "tree-sitter-typescript.wasm"],
        [".tsx", "tree-sitter-tsx.wasm"],
        [".js", "tree-sitter-javascript.wasm"],
        [".jsx", "tree-sitter-javascript.wasm"],
    ]);


    private constructor (private readonly parser: Parser, 
                         private readonly wasmUri: vscode.Uri
    ) {}

    static async create(extensionUri: vscode.Uri): Promise<CodeChunker> {
        const wasmUri = vscode.Uri.joinPath(extensionUri, 'wasm');

        await Parser.init({
            locateFile() {
                return vscode.Uri.joinPath(wasmUri, 'runtime', 'web-tree-sitter.wasm').fsPath;
            }
        });

        const parser = new Parser();
        return new CodeChunker(parser, wasmUri);
    }

    private async getLanguageForExtension(extension: string): Promise<Language> {
        const cachedLanguage = this.languageCache.get(extension);

        if (cachedLanguage) return cachedLanguage;

        const wasmFile = this.languageConfigs.get(extension);

        // Error if we do not have extension support, handle it outside
        if (!wasmFile) throw Error(`Unsupported extension: ${extension}`);

        const wasmPath = vscode.Uri.joinPath(this.wasmUri, 'languages', wasmFile).fsPath;
        const language = await Language.load(wasmPath);

        this.languageCache.set(extension, language);

        return language;
    }

    public async chunkWorkspace(): Promise<CodeChunk[]> {
        const includePattern = "**/*.{ts,tsx,js,jsx}";
        const excludePattern = "{**/node_modules/**,**/.git/**,**/dist/**,**/out/**,**/build/**,**/.next/**,**/coverage/**}";

        const uris = await vscode.workspace.findFiles(
            includePattern, excludePattern, 5000
        );
        const chunks: CodeChunk[] = [];

        for (const uri of uris) {
            try {
                const fileChunk = await this.chunkFile(uri);
                console.log(`Chunked file ${uri.fsPath}`);
                chunks.push(...fileChunk);
            } catch (e) {
                console.warn(`Failed to Chunk file ${uri.fsPath}`, e);
            }
        }
        return chunks;
    }

    public async chunkFile(uri: vscode.Uri): Promise<CodeChunk[]> {
        const filePath = vscode.workspace.asRelativePath(uri);
        const extension = this.getExtension(filePath);

        const language = await this.getLanguageForExtension(extension);
        const content = await getFileContent(uri);

        // skip empty files
        if (!content.trim()) return [];

        this.parser.setLanguage(language);
        const tree = this.parser.parse(content);
        const lines = content.split(/\r?\n/);
        
        if (!tree) return [];
        return this.chunkRootNode(tree.rootNode, lines, filePath);

    }

    private getExtension(filePath: string): string {
        const match = filePath.match(/\.[^.]+$/);
        return match ? match[0] : "";
    }

    private chunkRootNode(rootNode: Node, lines: string[], filePath: string): CodeChunk[] {
        const chunks: CodeChunk[] = [];

        for (let i = 0; i < rootNode.namedChildCount; i++) {
            const node = rootNode.namedChild(i);
            if (!node) continue;

            if (!this.isChunkableNode(node)) continue;

            chunks.push(this.nodeToChunk(node, lines, filePath));
        }
        return chunks;
    }

    private isChunkableNode(node: Node): boolean {
        return [
            "function_declaration",
            "class_declaration",
            "interface_declaration",
            "type_alias_declaration",
            "enum_declaration",
            "lexical_declaration",
            "export_statement",
        ].includes(node.type);
    }

    private nodeToChunk(node: Node, lines: string[], filePath: string): CodeChunk {
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;

        const text = lines.slice(startLine, endLine + 1).join("\n");

        return {
            text,
            filePath,
            startLine: startLine + 1,
            endLine: endLine + 1,
            type: node.type
        };
    }
}