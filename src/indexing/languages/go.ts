import { Node } from "web-tree-sitter";
import { LanguageConfig } from "./_languageTypes";

export const goChunkConfig: Omit<LanguageConfig, "wasmFile"> = {
    chunkableNodeTypes: new Set([
        "function_declaration",
        "method_declaration",
        "type_declaration",
    ]),

    symbolNodeTypes: new Set([
        "function_declaration",
        "method_declaration",
        "type_declaration",
    ]),
    
    importNodeTypes: new Set([
        "import_declaration"
    ]),

    getSymbolName(node: Node): string | undefined {
        return node.childForFieldName("name")?.text;
    },

    shouldRecurseInto(_node: Node): boolean {
        return true;
    },
};