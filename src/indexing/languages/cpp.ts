import { Node } from "web-tree-sitter";
import { LanguageConfig } from "./_languageTypes";

export const cppChunkConfig: Omit<LanguageConfig, "wasmFile"> = {
    chunkableNodeTypes: new Set([
        "function_definition",
        "class_specifier",
        "struct_specifier",
        "enum_specifier",
        "namespace_definition",
    ]),

    symbolNodeTypes: new Set([
        "function_definition",
        "class_specifier",
        "struct_specifier",
        "enum_specifier",
        "namespace_definition",
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