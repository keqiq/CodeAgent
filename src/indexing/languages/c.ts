import { Node } from "web-tree-sitter";
import { LanguageConfig } from "./_languageTypes";

export const cChunkConfig: Omit<LanguageConfig, "wasmFile"> = {
    chunkableNodeTypes: new Set([
        "function_definition",
        "struct_specifier",
        "enum_specifier",
        "union_specifier",
    ]),

    symbolNodeTypes: new Set([
        "function_definition",
        "struct_specifier",
        "enum_specifier",
        "union_specifier",
    ]),

    getSymbolName(node: Node): string | undefined {
        const name = node.childForFieldName("name")?.text;
        if (name) return name;

        const declarator = node.childForFieldName("declarator");
        return declarator?.childForFieldName("declarator")?.text
            ?? declarator?.text;
    },

    shouldRecurseInto(_node: Node): boolean {
        return true;
    },
};