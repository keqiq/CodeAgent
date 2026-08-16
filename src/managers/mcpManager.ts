import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { ToolResult, ToolSchema } from '../tools/toolIndex';

export interface MCPServerConfig {
    command: string;
    args: string[];
    env?: Record<string, string>;
    cwd?: string;
    maxBufferSize?: number;
}

export interface ToolState {
    name: string;
    description: string;
    enabled: boolean;
}

export interface ServerState {
    name: string;
    config: MCPServerConfig;
    status: 'connected' | 'connecting' | 'disconnected' | 'error';
    error?: string;
    tools: ToolState[];
}

export class MCPManager {
    private clients: Map<string, Client> = new Map();
    private transports: Map<string, StdioClientTransport> = new Map();

    private toolToClientMap: Map<string, { serverName: string; client: Client }> = new Map();

    private emitter = new vscode.EventEmitter<void>();
    public onDidUpdateStatus = this.emitter.event;

    constructor(private context: vscode.ExtensionContext) {}

    public async getServerStates(): Promise<ServerState[]> {
        const configs = this.getSavedServers();
        const states: ServerState[] = [];
        const allDisabled = this.context.globalState.get<Record<string, string[]>>('disabledMCPTools') || {};

        for (const [name, config] of Object.entries(configs)) {
            const client = this.clients.get(name);
            let tools: ToolState[] = [];
            let error: string | undefined = undefined;

            if (client) {
                try {
                    const response = await client.listTools();
                    const serverDisabled = new Set(allDisabled[name] || []);

                    tools = response.tools.map(t => ({
                        name: t.name,
                        description: t.description || '',
                        enabled: !serverDisabled.has(t.name)
                    }));

                    for (const tool of response.tools) {
                        this.toolToClientMap.set(tool.name, { serverName: name, client });
                    }
                } catch (e: any) {
                    error = e?.message || 'Failed to retrieve tools';
                }
            }

            states.push({
                name,
                config,
                status: client ? 'connected' : 'disconnected',
                error,
                tools
            });
        }

        return states;
    }

    public async handleMetaTool(args: { serverName?: string }): Promise<ToolResult> {
        if (!args?.serverName) {
            return this.listConnectedServers();
        }

        return this.listServerTools(args.serverName);
    }

    private async listConnectedServers(): Promise<ToolResult> {
        const connectedNames = Array.from(this.clients.keys());

        if (connectedNames.length === 0) {
            return {
                message: "No MCP servers are currently connected. Enable or configure servers in the MCP settings.",
                data: { connectedServers: [] }
            };
        }

        const serverSummaries: { name: string; toolCount: number; tools: string[] }[] = [];

        for (const name of connectedNames) {
            const client = this.clients.get(name);
            if (!client) continue;

            try {
                const response = await client.listTools();
                const allDisabled = this.context.globalState.get<Record<string, string[]>>('disabledMCPTools') || {};
                const serverDisabled = new Set(allDisabled[name] || []);

                const enabledTools = response.tools
                    .filter(t => !serverDisabled.has(t.name))
                    .map(t => t.name);

                serverSummaries.push({
                    name,
                    toolCount: enabledTools.length,
                    tools: enabledTools
                });
            } catch (e: any) {
                serverSummaries.push({
                    name,
                    toolCount: 0,
                    tools: []
                });
            }
        }

        const formatted = serverSummaries.map(s => 
            `• Server '${s.name}': ${s.toolCount} active tool(s) [${s.tools.join(', ') || 'none'}]`
        ).join('\n');

        const message = `Connected MCP Servers (${serverSummaries.length}):\n${formatted}\n\nTo see detailed schemas and instructions for a server's tools, call mcp({ serverName: "<name>" }).`;

        return {
            message,
            data: { servers: serverSummaries }
        };
    }

    private async listServerTools(serverName: string): Promise<ToolResult> {
        const client = this.clients.get(serverName);

        if (!client) {
            const connected = Array.from(this.clients.keys()).join(', ') || 'none';
            return {
                message: `MCP server '${serverName}' is not connected. Currently connected servers: [${connected}].`,
                data: { error: 'SERVER_NOT_CONNECTED', requestedServer: serverName }
            };
        }

        try {
            const response = await client.listTools();
            const allDisabled = this.context.globalState.get<Record<string, string[]>>('disabledMCPTools') || {};
            const serverDisabled = new Set(allDisabled[serverName] || []);

            const activeTools = response.tools.filter(t => !serverDisabled.has(t.name));

            if (activeTools.length === 0) {
                return {
                    message: `Server '${serverName}' is connected, but has 0 active tools (or all tools are disabled in settings).`,
                    data: { tools: [] }
                };
            }

            // Map tools for invocation routing
            for (const tool of activeTools) {
                this.toolToClientMap.set(tool.name, { serverName, client });
            }

            const toolDetails = activeTools.map(t => {
                const schemaStr = JSON.stringify(t.inputSchema || {}, null, 2);
                return `### Tool: ${t.name}\nDescription: ${t.description || 'No description'}\nParameters Schema:\n\`\`\`json\n${schemaStr}\n\`\`\``;
            }).join('\n\n');

            const message = `Available tools on '${serverName}':\n\n${toolDetails}\n\nYou can now call any of these tools directly.`;

            return {
                message,
                data: {
                    server: serverName,
                    tools: activeTools.map(t => ({
                        name: t.name,
                        description: t.description,
                        inputSchema: t.inputSchema
                    }))
                }
            };
        } catch (e: any) {
            return {
                message: `Failed to retrieve tools for MCP server '${serverName}': ${e.message || String(e)}`,
                data: { error: e.message }
            };
        }
    }

    public getSavedServers(): Record<string, MCPServerConfig> {
        return this.context.globalState.get('mcpServers') || {};
    }

    public async addServer(name: string, config: MCPServerConfig): Promise<void> {
        const servers = this.getSavedServers();
        servers[name] = config;
        await this.context.globalState.update('mcpServers', servers);
    }

    public async removeServer(name: string): Promise<void> {
        const servers = this.getSavedServers();
        delete servers[name];
        await this.context.globalState.update('mcpServers', servers);

        // Clean up disabled tools mapping
        const allDisabled = this.context.globalState.get<Record<string, string[]>>('disabledMCPTools') || {};
        if (allDisabled[name]) {
            delete allDisabled[name];
            await this.context.globalState.update('disabledMCPTools', allDisabled);
        }

        await this.disconnect(name);
    }

    public async toggleTool(serverName: string, toolName: string, enabled: boolean): Promise<void> {
        const allDisabled = this.context.globalState.get<Record<string, string[]>>('disabledMCPTools') || {};
        const serverDisabled = new Set(allDisabled[serverName] || []);

        if (enabled) {
            serverDisabled.delete(toolName);
        } else {
            serverDisabled.add(toolName);
        }

        allDisabled[serverName] = Array.from(serverDisabled);
        await this.context.globalState.update('disabledMCPTools', allDisabled);
    }

    public async connect(name: string): Promise<void> {
        if (this.clients.has(name)) return;

        const servers = this.getSavedServers();
        const config = servers[name];
        if (!config) {
            vscode.window.showErrorMessage(`MCP server ${name} not found in config!`);
            return;
        }

        const mergedEnv = config.env 
            ? { ...process.env, ...config.env } as Record<string, string>
            : process.env as Record<string, string>;

        const transport = new StdioClientTransport({
            command: config.command,
            args: config.args,
            env: mergedEnv,
            cwd: config.cwd,
            maxBufferSize: config.maxBufferSize
        });

        const client = new Client({ name: 'agent-client', version: '1.0.0' }, {
            capabilities: {}
        });

        await client.connect(transport);

        this.transports.set(name, transport);
        this.clients.set(name, client);
    }

    public async disconnect(name: string): Promise<void> {
        const transport = this.transports.get(name);
        if (transport) {
            await transport.close();
            this.transports.delete(name);
        }
        this.clients.delete(name);

        for (const [toolName, entry] of this.toolToClientMap.entries()) {
            if (entry.serverName === name) {
                this.toolToClientMap.delete(toolName);
            }
        }
    }

    public isToolEnabled(serverName: string, toolName: string): boolean {
        const allDisabled = this.context.globalState.get<Record<string, string[]>>('disabledMCPTools') || {};
        const serverDisabled = new Set(allDisabled[serverName] || []);
        return !serverDisabled.has(toolName);
    }

    public hasTool(toolName: string): boolean {
        const entry = this.toolToClientMap.get(toolName);
        if (!entry) return false;
        return this.isToolEnabled(entry.serverName, toolName);
    }

    // public async getConnectedTools(): Promise<ToolSchema[]> {
    //     const mcpSchemas: ToolSchema[] = [];
    //     const allDisabled = this.context.globalState.get<Record<string, string[]>>('disabledMCPTools') || {};

    //     for (const [serverName, client] of this.clients.entries()) {
    //         const response = await client.listTools();
    //         const serverDisabled = new Set(allDisabled[serverName] || []);

    //         for (const tool of response.tools) {
    //             this.toolToClientMap.set(tool.name, { serverName, client });

    //             // Only register tool with LLM if enabled
    //             if (!serverDisabled.has(tool.name)) {
    //                 mcpSchemas.push({
    //                     type: 'function',
    //                     name: tool.name,
    //                     description: tool.description || '',
    //                     parameters: tool.inputSchema as any
    //                 });
    //             }
    //         }
    //     }

    //     return mcpSchemas;
    // }

    public async callTool(toolName: string, args: any): Promise<ToolResult> {
        const entry = this.toolToClientMap.get(toolName);
        if (!entry || !this.isToolEnabled(entry.serverName, toolName)) {
            throw new Error(`MCP tool '${toolName}' is disabled or its server is disconnected.`);
        }
        
        const { client } = entry;
        const result = await client.callTool({
            name: toolName,
            arguments: args
        });

        let message = "";

        if ('content' in result && Array.isArray(result.content)) {
            if (result.isError) throw new Error('MCP tool returned an execution error.');
            
            message = result.content.map((block: any) => {
                switch (block.type) {
                    case 'text':
                        return block.text;
                    case 'image':
                    case 'audio':
                        return `[Tool returned ${block.type} data which is currently unsupported by the client]`;
                    case 'resource':
                        if ('text' in block.resource) {
                            return `Resource ${block.resource.uri}:\n${block.resource.text}`;
                        }
                        return `[Tool returned binary resource: ${block.resource.uri}]`;
                    case 'resource_link':
                        return `[Tool referenced external resource: ${block.uri}]`;
                    default:
                        return `[Unsupported tool output type]`;
                }
            }).join('\n');

        } else if ('toolResult' in result) {
            message = typeof result.toolResult === 'string' 
                ? result.toolResult 
                : JSON.stringify(result.toolResult, null, 2);
                
        } else {
            message = "Tool executed successfully, but returned an unrecognized format.";
        }

        return { message, data: result };
    }
}