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

export class MCPManager {
    private clients: Map<string, Client> = new Map();
    private transports: Map<string, StdioClientTransport> = new Map();

    constructor(private context: vscode.ExtensionContext) {}

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
        await this.disconnect(name);
    }

    public async connect(name: string): Promise<void> {
        // already connected
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

        const client = new Client({ name: '', version: '' }, {
            capabilities: { }
        });

        await transport.start();
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
    }

    public async getConnectedTools(): Promise<ToolSchema[]> {
        const mcpSchemas: ToolSchema[] = [];

        for (const [serverName, client] of this.clients.entries()) {
            const response = await client.listTools();

            for (const tool of response.tools) {
                mcpSchemas.push({
                    type: 'function',
                    name: tool.name,
                    description: tool.description || '',
                    parameters: tool.inputSchema as any
                });
            }
        }

        return mcpSchemas;
    }

    public async callTool(serverName: string, toolName: string, args: any): Promise<ToolResult> {
        const client = this.clients.get(serverName);
        if (!client) throw new Error(`MCP server ${serverName} is not connected.`);
        
        const result = await client.callTool({
            name: toolName,
            arguments: args
        });

        let message = "";

        if ('content' in result && Array.isArray(result.content)) {
            // Capture if the server explicitly flagged this execution as an error
            if (result.isError) throw new Error('MCP tool error.');
            
            message = result.content.map((block: any) => {
                switch (block.type) {
                    case 'text':
                        return block.text;

                    // Only support text outputs
                    case 'image':
                    case 'audio':
                        return `[Tool returned ${block.type} data which is currently unsupported by the client]`;
                    case 'resource':
                        // Resources might contain useful text
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

        // legacy response format
        } else if ('toolResult' in result) {
            message = typeof result.toolResult === 'string' 
                ? result.toolResult 
                : JSON.stringify(result.toolResult, null, 2);
                
        // completely unexpected formats
        } else {
            message = "Tool executed successfully, but returned an unrecognized format.";
        }

        return { message, data: result };
    }
}