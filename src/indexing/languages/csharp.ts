import { Node } from "web-tree-sitter";
import { LanguageConfig } from "./_languageTypes";

export const csharpChunkConfig: Omit<LanguageConfig, "wasmFile"> = {
    chunkableNodeTypes: new Set([
        "class_declaration",
        "interface_declaration",
        "struct_declaration",
        "enum_declaration",
        "record_declaration",
        "method_declaration",
        "constructor_declaration",
        "property_declaration",
    ]),

    symbolNodeTypes: new Set([
        "class_declaration",
        "interface_declaration",
        "struct_declaration",
        "enum_declaration",
        "record_declaration",
        "method_declaration",
        "constructor_declaration",
        "property_declaration",
    ]),

    getSymbolName(node: Node): string | undefined {
        return node.childForFieldName("name")?.text;
    },

    shouldRecurseInto(_node: Node): boolean {
        return true;
    },
};