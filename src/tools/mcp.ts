import { ToolSchema } from './toolIndex';

export const mcpSchemas: ToolSchema[] = [
    {
        type: "function",
        name: "mcp",
        description: "Discover connected MCP servers or inspect tools available on a specific server. Omit 'serverName' to list all connected servers. Provide 'serverName' to inspect the available tools and parameter schemas for that server.",
        parameters: {
            type: "object",
            properties: {
                serverName: {
                    type: "string",
                    description: "Optional name of the MCP server (e.g. 'sqlite', 'memory', 'filesystem'). If omitted, returns all connected servers."
                }
            },
            required: []
        }
    }
];