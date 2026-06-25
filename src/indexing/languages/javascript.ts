import { Node } from "web-tree-sitter";
import { LanguageConfig } from "./_languageTypes";

function isFunctionVariable(node: Node): boolean {
    if (node.type !== "variable_declarator") return false;

    const value = node.childForFieldName("value");
    if (!value) return false;

    return [
        "arrow_function",
        "function",
        "function_expression",
    ].includes(value.type);
}

export const javascriptChunkConfig: Omit<LanguageConfig, "wasmFile"> = {
    chunkableNodeTypes: new Set([
        "function_declaration",
        "class_declaration",
        "method_definition",
        "interface_declaration",
        "type_alias_declaration",
        "enum_declaration",
        "variable_declarator",
    ]),

    symbolNodeTypes: new Set([
        "function_declaration",
        "class_declaration",
        "method_definition",
        "interface_declaration",
        "type_alias_declaration",
        "enum_declaration",
        "variable_declarator",
    ]),

    importNodeTypes: new Set([
        "import_statement"
    ]),

    getSymbolName(node: Node): string | undefined {
        return node.childForFieldName("name")?.text;
    },

    isChunkableNode(node: Node): boolean {
        if (isFunctionVariable(node)) return true;

        return this.chunkableNodeTypes.has(node.type);
    },

    shouldRecurseInto(_node: Node): boolean {
        return true;
    },
};