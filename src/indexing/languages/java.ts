import { Node } from "web-tree-sitter";
import { LanguageConfig } from "./_languageTypes";

export const javaChunkConfig: Omit<LanguageConfig, "wasmFile"> = {
    chunkableNodeTypes: new Set([
        "class_declaration",
        "interface_declaration",
        "enum_declaration",
        "record_declaration",
        "method_declaration",
        "constructor_declaration",
    ]),

    symbolNodeTypes: new Set([
        "class_declaration",
        "interface_declaration",
        "enum_declaration",
        "record_declaration",
        "method_declaration",
        "constructor_declaration",
    ]),

    getSymbolName(node: Node): string | undefined {
        return node.childForFieldName("name")?.text;
    },

    shouldRecurseInto(_node: Node): boolean {
        return true;
    },
};