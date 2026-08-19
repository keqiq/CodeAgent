import { MCPManager } from '../managers/mcpManager';
import { ToolResult, ToolSchema } from './toolIndex';

export const mcpSchemas: ToolSchema[] = [
    {
        type: "function",
        name: "mcp_find",
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
    },
    // Not adding the mcp tool schemas to our ToolSchema to reduce input tokens
    // Instead the agent will dynamically find and call mcp tools
    {
        type: "function",
        name: "mcp_call",
        description: "Execute any discovered MCP tool by specifying its server, tool name, and argument object.",
        parameters: {
            type: "object",
            properties: {
                serverName: {
                    type: "string",
                    description: "The name of the target MCP server."
                },
                toolName: {
                    type: "string",
                    description: "The name of the MCP tool to execute (e.g., 'add', 'read_query')."
                },
                toolArgs: {
                    type: "object",
                    description: "The key-value arguments matching the tool's signature discovered earlier."
                }
            },
            required: ["serverName", "toolName", "toolArgs"]
        }
    }
];

export async function executeMCPFind(serverName: string, mcpManager: MCPManager): Promise<ToolResult> {
    if (!serverName) {
        const connectedServers = mcpManager.getConnectedServers();
        
        if (connectedServers.length === 0) {
            return { message: "No MCP servers are currently connected." };
        }

        const serverSummaries = connectedServers.map(name => {
            const tools = mcpManager.getServerTools(name);
            const toolSigs = tools.length > 0 
                ? tools.map(t => `- **${t.signature}**: ${t.description || 'No description'}`).join('\n  ')
                : 'No active tools';
            return `**${name}**:\n  ${toolSigs}`;
        });

        return { 
            message: `Connected MCP Servers and available tools:\n\n${serverSummaries.join('\n\n')}\n\nUse 'mcp_find' again and provide a specific 'serverName' to get the detailed parameter schemas for these tools.` 
        };
    }

    const tools = mcpManager.getServerTools(serverName);

    if (tools.length === 0) {
        return { message: `No active tools found for server: '${serverName}'. It may be disconnected, not configured, or all tools are disabled.` };
    }

    const detailedTools = tools.map(t => {
        const descBlock = t.description ? `  Description: ${t.description}\n` : '';
        // Insert the description right between the tool name and the parameters
        return t.details.replace('\n', `\n${descBlock}`); 
    }).join('\n\n');
    
    return { 
        message: `Detailed tool schemas for '${serverName}':\n\n${detailedTools}` 
    };
}

export async function executeMCPCall(serverName: string, toolName: string, toolArgs: string, mcpManager: MCPManager) {
    return await mcpManager.callTool(serverName, toolName, toolArgs);
}