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

export interface ToolSchema {
    type: "function";
    name: string;
    description: string;
    parameters: ToolParameters;
    strict?: boolean;
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

export type ToolDeps = {
    createSearchCodebaseDeps: () => Promise<SearchCodebaseDeps>;
    getCwd: () => string;
    getSignal: () => AbortSignal;
};

export function createToolRegistry(deps: ToolDeps): Record<string, (args: any) => Promise<ToolResult>> {
    return {
        glob: async (args) => await executeGlob(args.pattern, deps.getCwd(), deps.getSignal()),

        grep: async (args) => await executeGrep(args.query, args.filePattern, deps.getCwd(), deps.getSignal()),

        read: async (args) => await executeRead(args.filePath, deps.getCwd()),

        write: async (args) => await executeWrite(args.filePath, args.content, deps.getCwd()),

        edit: async (args) => await executeEdit(args.filePath, args.oldText, args.newText, deps.getCwd()),

        searchCodebase: async (args) => {
            try {
                const searchDeps = await deps.createSearchCodebaseDeps();
                return await executeSearchCodebase(args.query, searchDeps, deps.getSignal());
            } catch (e) {
                return {
                    ok: false,
                    message: `Codebase semantic search unavailable: ${e instanceof Error ? e.message : String(e)}. Use glob, grep, or read instead.`
                };
            }
        }
    };
}