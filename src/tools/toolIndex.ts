import { searchSchemas, executeGlob, executeGrep, executeRefs, findDeps, executeFind } from "./search";
import { fileSchemas, executeRead, executeWrite, executeEdit } from "./files";
import { commandSchemas, executeRun } from "./execute";
import { webSchema, executeWebSearch, executeURL } from "./web";
import { ContextManager } from "../contextManager";
import { artifactSchema, executeRecall } from "./artifact";

export interface ToolProperty {
    type: string;
    description?: string;
    enum?: string[];
    items?: {
        type: string;
        description?: string;
    };
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
export const requiredSchemas: ToolSchema[] = [
    ...searchSchemas,
    ...fileSchemas,
    ...commandSchemas,
    ...artifactSchema
];

export { webSchema };

export type ToolDeps = {
    getFindDeps: () => Promise<findDeps>;
    getCwd: () => string;
    getSignal: () => AbortSignal;
    getTavilyKey:() => Promise<string>;
    getContext:() => ContextManager
};

export function createToolRegistry(deps: ToolDeps): Record<string, (args: any) => Promise<ToolResult>> {
    return {
        glob: async (args) => await executeGlob(args.pattern, deps.getCwd(), deps.getSignal()),

        grep: async (args) => await executeGrep(args.query, args.filePattern, deps.getCwd(), deps.getSignal()),

        refs: async (args) => await executeRefs(args.filePath, args.line, args.symbol, deps.getCwd()),

        read: async (args) => await executeRead(args.filePath, deps.getCwd()),

        write: async (args) => await executeWrite(args.filePath, args.content, deps.getCwd()),

        edit: async (args) => await executeEdit(args.filePath, args.oldText, args.newText, deps.getCwd()),

        run: async (args) => await executeRun(args.command, deps.getCwd(), deps.getSignal()),

        web: async (args) => {
            const apiKey = await deps.getTavilyKey();
            return await executeWebSearch(args.query, apiKey, deps.getSignal());
        },

        url: async (args) => {
            const apiKey = await deps.getTavilyKey();
            return await executeURL(args.urls, apiKey, args.query, deps.getSignal());
        },

        find: async (args) => {
            const searchDeps = await deps.getFindDeps();
            return await executeFind(args.query, searchDeps, deps.getSignal());
        },

        recall: async (args) => {
            return await executeRecall(args.artifactID, deps.getContext(), deps.getSignal());
        }
    };
}