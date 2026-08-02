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
    private neighbourhoodCache = new Map<string, string[]>();

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
    
    public async chunkWorkspace(): Promise<CodeChunk[]> {
        const uris = await vscode.workspace.findFiles(
            includePattern, excludePattern, 5000
        );
        const chunks: CodeChunk[] = [];
        
        for (const uri of uris) {
            try {
                const fileChunk = await this.chunkFile(uri);
                // console.log(`Chunked file ${uri.fsPath}`);
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
        
        const siblings = await this.getSiblingFiles(uri);
        
        this.parser.setLanguage(language);
        const tree = this.parser.parse(content);
        const lines = content.split(/\r?\n/);
        
        if (!tree) return [];
        return this.chunkRootNode(tree.rootNode, config, lines, filePath, siblings);
        
    }

    public clearNeighbourHoodCache() {
        this.neighbourhoodCache.clear();
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
    private getExtension(filePath: string): string {
        const match = filePath.match(/\.[^.]+$/);
        return match ? match[0] : "";
    }
    
    private chunkRootNode(
        rootNode: Node, 
        config: LanguageConfig, 
        lines: string[], 
        filePath: string,
        siblings: string
    ): CodeChunk[] {
        
        const chunks: CodeChunk[] = [];
        
        const fileImports = this.extractImports(rootNode, config, lines);
        
        this.collectChunks(rootNode, config, lines, filePath, fileImports, siblings, chunks, undefined);
        return chunks;
    }

    private collectChunks(
        node: Node,
        config: LanguageConfig,
        lines: string[],
        filePath: string,
        fileImports: string,
        siblings: string,
        chunks: CodeChunk[],
        parentSymbol?: string)
    : void {

        const symbol = config.getSymbolName(node);
        const nextParent = symbol ?? parentSymbol;

        const isChunkable = config.isChunkableNode
            ? config.isChunkableNode(node)
            : config.chunkableNodeTypes.has(node.type);

        if (isChunkable) {

            // Node has appropriate size, emit 
            if (this.shouldEmitWholeNode(node)) chunks.push(this.nodeToChunk(node, config, lines, filePath, fileImports, siblings, parentSymbol));
                
            else {
                // For overly large nodes, use sliding window with overlap to chunk lines
                const windowedChunks = this.SlidingChunkNode(node, config, lines, filePath, fileImports, siblings, parentSymbol);
                chunks.push(...windowedChunks);
            }
        }

        if (config.shouldRecurseInto && !config.shouldRecurseInto(node)) return;

        // Get node children as separate nodes as well
        for (let i = 0; i < node.namedChildCount; i++) {
            const child = node.namedChild(i);
            if (!child) continue;

            this.collectChunks(child, config, lines, filePath, fileImports, siblings, chunks, nextParent);
        }
    }

    private nodeToChunk(
        node: Node, 
        config: LanguageConfig, 
        lines: string[], 
        filePath: string, 
        fileImports: string,
        siblings: string,
        parentSymbol?: string
    ): CodeChunk {

        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;

        const sourceText = lines.slice(startLine, endLine + 1).join("\n");
        const symbol = config.getSymbolName(node);

        const header = [
            `File: ${filePath}`,
            siblings ? siblings.trim() : undefined,
            fileImports ? fileImports.trim() : undefined,
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

    private SlidingChunkNode(
        node: Node, 
        config: LanguageConfig, 
        lines: string[], 
        filePath: string,
        fileImports: string,
        siblings: string,
        parentSymbol?: string
    ): CodeChunk[] {

        const chunks: CodeChunk[] = [];
        const startLine = node.startPosition.row;
        const endLine = node.endPosition.row;

        const nodeLines = lines.slice(startLine, endLine + 1);
        const symbol = config.getSymbolName(node);

        const CHUNK_SIZE = 100;
        const OVERLAP = 20;

        for (let i = 0; i < nodeLines.length; i+= (CHUNK_SIZE - OVERLAP)) {
            const chunkLines = nodeLines.slice(i, i + CHUNK_SIZE);

            if (chunkLines.length < this.MIN_CHUNK_LINES) break;

            const header = [
                `File: ${filePath}`,
                siblings ? siblings.trim() : undefined,
                fileImports ? fileImports.trim() : undefined,
                parentSymbol ? `Parent: ${parentSymbol}` : undefined,
                symbol ? `Symbol: ${symbol} (Part ${Math.floor(i / (CHUNK_SIZE - OVERLAP)) + 1})` : undefined,
                `Type: ${node.type}`
            ].filter(Boolean).join("\n");

            const text = `${header}\n\n${chunkLines.join("\n")}`;

            chunks.push({
                text,
                filePath,
                startLine: startLine + i + 1,
                endLine: startLine + i + chunkLines.length,
                type: node.type,
                symbol: symbol ?? "",
                parentSymbol: parentSymbol ?? ""
            });
        }
        return chunks;
    }

    private extractImports(rootNode: Node, config: LanguageConfig, lines: string[]): string {
        if (!config.importNodeTypes) return "";

        const imports: string[] = [];

        for (let i = 0; i < rootNode.namedChildCount; i++) {
            const child = rootNode.namedChild(i);

            if (child && config.importNodeTypes.has(child.type)) {
                const start = child.startPosition.row;
                const end = child.endPosition.row;

                imports.push(lines.slice(start, end+1).join("\n"));
            }
        }

        if (imports.length === 0) return "[IMPORTS]\n[/IMPORTS]";

        return `[IMPORTS]\n${imports.join("\n")}\n[/IMPORTS]`;
    }

    private async getSiblingFiles(uri: vscode.Uri): Promise<string> {
        try {
            const parentUri = vscode.Uri.joinPath(uri, '..');
            const parentPath = parentUri.fsPath;
            const currentFileName = uri.path.split('/').pop();

            let allFiles: string[];

            if (this.neighbourhoodCache.has(parentPath)) {
                allFiles = this.neighbourhoodCache.get(parentPath)!;
            } else {
                const entries = await vscode.workspace.fs.readDirectory(parentUri);
                allFiles = entries
                    .filter(([name, type]) => type === vscode.FileType.File)
                    .map(([name]) => name);

                this.neighbourhoodCache.set(parentPath, allFiles);
            }

            const siblings = allFiles
                .filter(name => name !== currentFileName)
                .map(name => `  - ${name}`);


            if (siblings.length === 0) return "[SIBLINGS]\n[/SIBLINGS]";

            return `[SIBLINGS]\n${siblings.join('\n')}\n[/SIBLINGS]`;

        } catch (e) {
            console.warn(`Failed to read siblings for ${uri.fsPath}`, e);
            return "[IMPORTS]\n[/IMPORTS]";;
        }
    }

    public async getFileContext(uri: vscode.Uri): Promise<{ imports: string; siblings: string }> {
        const filePath = vscode.workspace.asRelativePath(uri);
        const extension = this.getExtension(filePath);

        const language = await this.getLanguageForExtension(extension);
        const content = await getFileContent(uri);
        const config = languageConfigs.get(extension);

        if (!config) throw Error(`Unsupported extension: ${extension}`);

        // skip empty files
        if (!content.trim()) return {imports: "", siblings: ""};

        const siblings = await this.getSiblingFiles(uri);

        this.parser.setLanguage(language);
        const tree = this.parser.parse(content);
        const lines = content.split(/\r?\n/);

        if (!tree) return {imports: "", siblings: ""};

        const imports = this.extractImports(tree.rootNode, config, lines);

        return {imports, siblings};
    }
}