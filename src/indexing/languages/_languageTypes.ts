import { Node } from "web-tree-sitter";

export interface LanguageConfig {
    wasmFile: string;
    chunkableNodeTypes: Set<string>;
    symbolNodeTypes: Set<string>;
    importNodeTypes: Set<string>;
    getSymbolName(node: Node): string | undefined;
    isChunkableNode?(node: Node): boolean;
    shouldRecurseInto?(node: Node): boolean;
}
