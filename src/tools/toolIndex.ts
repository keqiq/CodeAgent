import { searchSchemas, executeGlob, executeGrep, executeRefs, findDeps, executeFind } from "./search";
import { fileSchemas, executeRead, executeWrite, executeEdit } from "./files";
import { commandSchemas } from "./execute";
import { webSchema, executeWebSearch, executeURL } from "./web";
import { mcpSchemas } from "./mcp";
import { ContextManager } from "../managers/contextManager";
import { artifactSchema } from "./artifact";
import { CommandManager } from "../managers/commandManager";
import { MCPManager } from "../managers/mcpManager";

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
    data?: unknown;
}
export const requiredSchemas: ToolSchema[] = [
    ...searchSchemas,
    ...fileSchemas,
    ...commandSchemas,
    ...artifactSchema,
    ...mcpSchemas
];

export { webSchema };

export type ToolDeps = {
    getSignal: () => AbortSignal;
    getCwd: () => string;
    getFindDeps: () => Promise<findDeps>;
    getWebDeps:() => Promise<string>;
    getContextManager:() => ContextManager;
    getCommandManager:() => CommandManager;
    getMCPManager:() => MCPManager;
};

// Tools with potentionally large output that could use pruning
export const PRUNE_TOOLS = new Set(['read', 'glob', 'grep', 'find', 'refs', 'run', 'web', 'url']);

export function createToolRegistry(deps: ToolDeps): Record<string, (args: any, toolID: string) => Promise<ToolResult>> {
    return {
        glob: async (args) => await executeGlob(args.pattern, deps.getCwd(), deps.getSignal()),

        grep: async (args) => await executeGrep(args.query, args.filePattern, deps.getCwd(), deps.getSignal()),

        refs: async (args) => await executeRefs(args.filePath, args.line, args.symbol, deps.getCwd()),

        read: async (args) => await executeRead(args.filePath, deps.getCwd()),

        write: async (args) => await executeWrite(args.filePath, args.content, deps.getCwd()),

        edit: async (args) => await executeEdit(args.filePath, args.oldText, args.newText, deps.getCwd()),

        run: async (args, toolID) => {
            const manager = deps.getCommandManager();
            
            return await manager.execute(
                args.command,
                args.cwd,
                deps.getCwd(),
                deps.getSignal(),
                toolID
            );
        },

        web: async (args) => {
            const apiKey = await deps.getWebDeps();
            return await executeWebSearch(args.query, apiKey, deps.getSignal());
        },

        url: async (args) => {
            const apiKey = await deps.getWebDeps();
            return await executeURL(args.urls, apiKey, args.query, deps.getSignal());
        },

        find: async (args) => {
            const findDeps = await deps.getFindDeps();
            return await executeFind(args.query, findDeps, deps.getSignal());
        },

        recall: async (args) => {
            const manager = deps.getContextManager();
            return {
                message: await manager.readArtifact(args.artifactID),
                data: args.artifactID
            };
        },

        mcp: async (args) => {
            const manager = deps.getMCPManager();
            return await manager.handleMetaTool(args.serverName);
        }
    };
}