import { searchSchemas, executeGlob, executeGrep, SearchCodebaseDeps, executeSearchCodebase } from "./search";
import { fileSchemas, executeRead, executeWrite, executeEdit } from "./files";

export interface ToolProperty {
    type: string;
    description?: string;
    enum?: string[];
}

export interface ToolParameters {
    type: "object"; 
    properties: Record<string, ToolProperty>;
    required?: string[];
}

export interface ToolFunction {
    name: string;
    description: string;
    parameters: ToolParameters;
}
export interface ToolSchema {
    type: string, function: ToolFunction
}

export interface ToolResult {
    message: string;

    changedFiles?: string[];
    data?: unknown;
}
export const allToolSchemas: ToolSchema[] = [
    ...searchSchemas,
    ...fileSchemas,
];

// export const toolRegistry: Record<string, (args: any) => Promise<string>> = {
//     "glob":     async (args) => await executeGlob(args.pattern),
//     "grep":     async (args) => await executeGrep(args.query, args.filePattern),
//     "read":     async (args) => await executeRead(args.filePath),
//     "write":    async (args) => await executeWrite(args.filePath, args.content),
//     "edit":     async (args) => await executeEdit(args.filePath, args.oldText, args.newText)
// };

export type ToolDeps = {
    createSearchCodebaseDeps: () => Promise<SearchCodebaseDeps>;
};

export function createToolRegistry(deps: ToolDeps): Record<string, (args: any) => Promise<ToolResult>> {
    return {
        glob: async (args) => await executeGlob(args.pattern),

        grep: async (args) => await executeGrep(args.query, args.filePattern),

        read: async (args) => await executeRead(args.filePath),

        write: async (args) => await executeWrite(args.filePath, args.content),

        edit: async (args) => await executeEdit(args.filePath, args.oldText, args.newText),

        searchCodebase: async (args) => {
            try {
                const searchDeps = await deps.createSearchCodebaseDeps();
                return await executeSearchCodebase(args.query, searchDeps);
            } catch (e) {
                return {
                    ok: false,
                    message: `Codebase semantic search unavailable: ${e instanceof Error ? e.message : String(e)}. Use glob, grep, or read instead.`
                };
            }
        }
    };
}