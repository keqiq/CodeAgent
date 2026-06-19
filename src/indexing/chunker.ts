import * as vscode from 'vscode';
import { Language, Parser, Node } from 'web-tree-sitter';
import { getFileContent } from '../utils/workspace';
import { languageConfigs, includePattern, excludePattern} from './languages/_languageIndex';
import { LanguageConfig } from './languages/_languageTypes';

export interface CodeChunk {
    text: string;
    filePath: string;
    startLine: number;
    endLine: number;
    type: string;
    symbol: string;
    parentSymbol: string;
}

export class CodeChunker {
    private readonly MAX_CHUNK_LINES = 120;
    private readonly MIN_CHUNK_LINES = 3;

    private readonly languageCache = new Map<string, Language>();

    private constructor(private readonly parser: Parser,
        private readonly wasmUri: vscode.Uri
    ) { }

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

        const config = languageConfigs.get(extension);

        // Error if we do not have extension support, handle it outside
        if (!config) throw Error(`Unsupported extension: ${extension}`);

        const wasmPath = vscode.Uri.joinPath(this.wasmUri, 'languages', config.wasmFile).fsPath;

        const language = await Language.load(wasmPath);

        this.languageCache.set(extension, language);

        return language;
    }

    public async chunkWorkspace(): Promise<CodeChunk[]> {
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
        const config = languageConfigs.get(extension);

        if (!config) throw Error(`Unsupported extension: ${extension}`);

        // skip empty files
        if (!content.trim()) return [];

        this.parser.setLanguage(language);
        const tree = this.parser.parse(content);
        const lines = content.split(/\r?\n/);

        if (!tree) return [];
        return this.chunkRootNode(tree.rootNode, config, lines, filePath);

    }

    private getExtension(filePath: string): string {
        const match = filePath.match(/\.[^.]+$/);
        return match ? match[0] : "";
    }

    private chunkRootNode(rootNode: Node, config: LanguageConfig, lines: string[], filePath: string): CodeChunk[] {
        const chunks: CodeChunk[] = [];
        this.collectChunks(rootNode, config, lines, filePath, chunks, undefined);
        return chunks;
    }

    private collectChunks(
        node: Node,
        config: LanguageConfig,
        lines: string[],
        filePath: string,
        chunks: CodeChunk[],
        parentSymbol?: string)
        : void {

        const symbol = config.getSymbolName(node);
        const nextParent = symbol ?? parentSymbol;

        const isChunkable = config.isChunkableNode
            ? config.isChunkableNode(node)
            : config.chunkableNodeTypes.has(node.type);

        if (isChunkable && this.shouldEmitWholeNode(node)) {
            chunks.push(this.nodeToChunk(node, config, lines, filePath, parentSymbol));
            return;
        }

        if (config.shouldRecurseInto && !config.shouldRecurseInto(node)) return;

        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (!child) continue;

            this.collectChunks(child, config, lines, filePath, chunks, nextParent);
        }
    }

    private nodeToChunk(node: Node, config: LanguageConfig, lines: string[], filePath: string, parentSymbol?: string): CodeChunk {
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;

        const sourceText = lines.slice(startLine, endLine + 1).join("\n");
        const symbol = config.getSymbolName(node);

        const header = [
            `File: ${filePath}`,
            parentSymbol ? `Parent: ${parentSymbol}` : undefined,
            symbol ? `Symbol: ${symbol}` : undefined,
            `Type: ${node.type}`,
        ].filter(Boolean).join("\n");

        const text = `${header}\n\n${sourceText}`;

        return {
            text,
            filePath,
            startLine: startLine + 1,
            endLine: endLine + 1,
            type: node.type,
            symbol: symbol ?? "",
            parentSymbol: parentSymbol ?? ""
        };
    }

    // Limit to to max line count per node for better embedding
    private shouldEmitWholeNode(node: Node): boolean {
        const lineCount = node.endPosition.row - node.startPosition.row + 1;
        return lineCount <= this.MAX_CHUNK_LINES;
    }
}