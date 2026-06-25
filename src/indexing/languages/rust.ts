import { Node } from "web-tree-sitter";
import { LanguageConfig } from "./_languageTypes";

export const rustChunkConfig: Omit<LanguageConfig, "wasmFile"> = {
    chunkableNodeTypes: new Set([
        "function_item",
        "struct_item",
        "enum_item",
        "trait_item",
        "impl_item",
        "mod_item",
        "type_item",
    ]),

    symbolNodeTypes: new Set([
        "function_item",
        "struct_item",
        "enum_item",
        "trait_item",
        "impl_item",
        "mod_item",
        "type_item",
    ]),

    importNodeTypes: new Set([
        "use_declaration"
    ]),

    getSymbolName(node: Node): string | undefined {
        return node.childForFieldName("name")?.text;
    },

    shouldRecurseInto(_node: Node): boolean {
        return true;
    },
};