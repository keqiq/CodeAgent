import { Node } from "web-tree-sitter";
import { LanguageConfig } from "./_languageTypes";

function findNamedChild(node: Node, types: string[]): Node | undefined {
    for (let i = 0; i < node.namedChildCount; i++) {
        const child = node.namedChild(i);
        if (child && types.includes(child.type)) return child;
    }
    return undefined;
}

export const pythonChunkConfig: Omit<LanguageConfig, "wasmFile"> = {
    chunkableNodeTypes: new Set([
        "function_definition",
        "class_definition",
        "decorated_definition",
    ]),

    symbolNodeTypes: new Set([
        "function_definition",
        "class_definition",
        "decorated_definition",
    ]),
    
    importNodeTypes: new Set([
        "import_statement",
        "import_from_statement"
    ]),

    getSymbolName(node: Node): string | undefined {
        const directName = node.childForFieldName("name")?.text;
        if (directName) return directName;

        if (node.type === "decorated_definition") {
            const inner = findNamedChild(node, [
                "function_definition",
                "class_definition",
            ]);
            return inner?.childForFieldName("name")?.text;
        }

        return undefined;
    },

    shouldRecurseInto(_node: Node): boolean {
        return true;
    },
};