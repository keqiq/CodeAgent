import * as vscode from 'vscode';
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { ToolResult } from '../tools/toolIndex';

export interface ServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    cwd?: string;
}

export interface MCPTool {
    name: string;
    description?: string;
    signature: string;
    details: string;
    disabled?: boolean;
}

export interface ServerState {
    name: string;
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    config: ServerConfig;
    disabledTools?: Set<string>;
}

export interface MCPHeaderStats {
    serversActive: number;
    serversTotal: number;
    toolsActive: number;
    toolsTotal: number;
}

export class MCPManager {
    private serverStates: Map<string, ServerState> = new Map();
    private serverTools: Map<string, Map<string, MCPTool>> = new Map();
    private clients: Map<string, Client> = new Map();

    private emitter = new vscode.EventEmitter();
    public readonly onDidUpdateStatus = this.emitter.event;

    constructor(private context: vscode.ExtensionContext) {
        const savedStates = this.context.globalState.get<Record<string, ServerState>>('MCP_Servers', {});

        for (const [name, state] of Object.entries(savedStates)) {
            this.serverStates.set(name, {
                name: name,
                status: state.status,
                config: state.config,
                disabledTools: new Set(state.disabledTools || [])
            });
        }
    }

    public getAllServerStates(): Record<string, ServerState> {
        const result: Record<string, ServerState> = {};
        for (const [name, state] of this.serverStates.entries()) {
            result[name] = state;
        }
        return result;
    }

    public getHeaderStats(): MCPHeaderStats {
        const serversTotal = this.serverStates.size;
        let serversActive = 0;

        for (const state of this.serverStates.values()) {
            if (state.status === 'connected') {
                serversActive++;
            }
        }

        let toolsTotal = 0;
        let toolsActive = 0;

        for (const [serverName, toolMap] of this.serverTools.entries()) {
            const state = this.serverStates.get(serverName);
            // Only count tools from actively connected servers
            if (state && state.status === 'connected') {
                for (const tool of toolMap.values()) {
                    toolsTotal++;
                    if (!tool.disabled) {
                        toolsActive++;
                    }
                }
            }
        }

        return { serversActive, serversTotal, toolsActive, toolsTotal };
    }

    public emitHeaderStats(): void {
        const stats = this.getHeaderStats();
        this.emitter.fire({
            type: 'updateHeaderStats',
            ...stats
        });
    }

    private async saveServerState(): Promise<void> {
        const stateObj: Record<string, any> = {};

        for (const [name, state] of this.serverStates.entries()) {
            stateObj[name] = {
                status: state.status,
                config: state.config,
                disabledTools: Array.from(state.disabledTools || [])
            };
        }

        await this.context.globalState.update('MCP_Servers', stateObj);
    }

    private updateServerState(serverName: string, status: 'connected' | 'disconnected' | 'connecting' | 'error'): void {
        if (!this.serverStates.has(serverName)) return;
        this.serverStates.get(serverName)!.status = status;

        this.emitter.fire({
            type: 'updateServerState',
            serverName,
            status
        });

        this.emitHeaderStats();
    }

    public async restoreServerState(): Promise<void> {
        // Reconnect servers that were previously connected or connecting
        const connectionTasks = Array.from(this.serverStates.entries())
            .filter(([_, state]) => state.status === 'connected' || state.status === 'connecting')
            .map(async ([serverName]) => {
                await this.connect(serverName);
            });

        await Promise.all(connectionTasks);
    }

    public async addServer(serverName: string, config: ServerConfig): Promise<void> {
        this.serverStates.set(serverName, { name: serverName, status: 'disconnected', config: config });
        await this.saveServerState();

        this.emitter.fire({
            type: 'addServer',
            serverName,
            config,
            status: 'disconnected'
        });

        this.emitHeaderStats();
    }

    public async removeServer(serverName: string): Promise<void> {
        if (!this.serverStates.has(serverName)) {
            console.warn(`Attempted to remove unknown server: ${serverName}.`);
            return;
        }

        // Do not save the state during disconnect since we need to delete the entry in serverState first
        await this.disconnect(serverName, false);

        this.serverStates.delete(serverName);
        await this.saveServerState();

        this.emitter.fire({ type: 'removeMCPServer', name: serverName });
        this.emitHeaderStats();
    }

    public getConnectedServers(): string[] {
        const connectedServers = Array.from(this.clients.keys());
        return connectedServers;
    }

    public async connect(serverName: string): Promise<void> {
        if (!this.serverStates.has(serverName)) {
            vscode.window.showErrorMessage(`Cannot connect to unconfigured server: ${serverName}!`);
            return;
        }

        const serverState = this.serverStates.get(serverName);
        if (this.clients.has(serverName)) {
            console.warn(`Already connected or connecting to ${serverName} server.`);
            return;
        }

        this.updateServerState(serverName, 'connecting');

        try {
            const config = serverState!.config;
            const mergedEnv = config?.env
                ? { ...process.env, ...config.env } as Record<string, string>
                : process.env as Record<string, string>;

            let transport;
            if (config.command) {
                transport = new StdioClientTransport({
                    command: config.command,
                    args: config.args,
                    env: mergedEnv,
                    cwd: config.cwd
                });
            } else if (config.url) {
                transport = new StreamableHTTPClientTransport(new URL(config.url));
            } else {
                throw new Error('Invalid MCP server configuration.');
            }

            const client = new Client({ name: 'vscodeagent-client', version: '1.0.0' }, { capabilities: {} });

            await client.connect(transport);
            this.clients.set(serverName, client);
            await this.loadTools(serverName);
            this.updateServerState(serverName, 'connected');
            await this.saveServerState();
        } catch (e) {
            console.error(`Error connecting to ${serverName}`, e);
            this.updateServerState(serverName, 'error');
        }
    }

    public async disconnect(serverName: string, saveState: boolean = true): Promise<void> {
        if (!this.clients.has(serverName)) {
            console.warn(`Attempted to disconnect unknown server: ${serverName}.`);
            return;
        }

        const client = this.clients.get(serverName);
        if (client) {
            try {
                await client.close();
            } catch (error) {
                console.error(`Error closing MCP client for ${serverName}:`, error);
            } finally {
                this.clients.delete(serverName);
            }
        }

        // Remove tools from the cache
        this.serverTools.delete(serverName);

        this.updateServerState(serverName, 'disconnected');

        if (saveState) await this.saveServerState();
    }

    public async loadTools(serverName: string): Promise<void> {
        const client = this.clients.get(serverName);

        if (!client) return;

        try {
            const response = await client.listTools();
            const toolMap = new Map<string, MCPTool>();

            const disabledTools = this.serverStates.get(serverName)!.disabledTools;
            for (const t of response.tools) {
                toolMap.set(t.name, {
                    name: t.name,
                    description: t.description,
                    signature: this.formatToolSignature(t),
                    details: this.formatToolDetails(t),
                    disabled: disabledTools?.has(t.name)
                });
            }

            this.serverTools.set(serverName, toolMap);

            this.emitter.fire({ type: 'updateServerTools', serverName, tools: Array.from(toolMap.values()) });

        } catch (e) {
            console.warn(`Error loading tools from server: ${serverName}`, e);
        }
    }

    private formatToolSignature(tool: { name: string; description?: string; inputSchema?: any }): string {
        const schema = tool.inputSchema || {};
        const props = schema.properties || {};
        const requiredSet = new Set(schema.required || []);

        const paramList = Object.entries(props).map(([propName, propDef]: [string, any]) => {
            const typeStr = propDef.type || 'any';
            const optionalFlag = requiredSet.has(propName) ? '' : '?';
            return `${propName}${optionalFlag}: ${typeStr}`;
        });

        const sig = `${tool.name}(${paramList.join(', ')})`;
        return sig;
    }

    private formatToolDetails(tool: { name: string; description?: string; inputSchema?: any }): string {
        const schema = tool.inputSchema || {};
        const props = schema.properties || {};
        const requiredSet = new Set(schema.required || []);

        const paramEntries = Object.entries(props).map(([name, propDef]: [string, any]) => {
            const isReq = requiredSet.has(name) ? 'required' : 'optional';
            const typeStr = propDef.type || 'any';
            const descStr = propDef.description ? ` - ${propDef.description}` : '';
            const enumStr = propDef.enum ? ` [allowed: ${propDef.enum.join(', ')}]` : '';
            return `    - \`${name}\` (${typeStr}, ${isReq}${enumStr})${descStr}`;
        });

        const paramBlock = paramEntries.length > 0
            ? `  Parameters:\n${paramEntries.join('\n')}`
            : `  Parameters: None`;

        return `### Tool: \`${tool.name}\`\n${paramBlock}`;
    }

    public getServerTools(serverName: string): MCPTool[] {
        const toolMap = this.serverTools.get(serverName);
        if (!toolMap) return [];

        return Array.from(toolMap.values()).filter(tool => !tool.disabled);
    }

    public async toggleTool(serverName: string, toolName: string, enabled: boolean): Promise<void> {
        const state = this.serverStates.get(serverName);
        if (!state) return;

        if (enabled) state.disabledTools?.delete(toolName);
        else state.disabledTools?.add(toolName);

        const toolMap = this.serverTools.get(serverName);
        if (toolMap && toolMap.has(toolName)) {
            toolMap.get(toolName)!.disabled = !enabled;
        }

        await this.saveServerState();
        this.emitHeaderStats();
    }

    public async callTool(serverName: string, toolName: string, args: any): Promise<ToolResult> {
        const client = this.clients.get(serverName);
        if (!client) throw new Error(`Error: Server '${serverName}' is not configured or not connected.`);

        const toolMap = this.serverTools.get(serverName);
        const tool = toolMap?.get(toolName);
        if (!tool) throw new Error(`Error: Tool '${toolName}' not found on server '${serverName}'.`);
        if (tool.disabled) throw new Error(`Error: Tool '${toolName}' is disabled by the user.`);

        let parsedArgs = args;
        if (typeof args === 'string') {
            try {
                parsedArgs = JSON.parse(args);
            } catch {
                throw new Error(`Error parsing argument. Arguments must be a valid JSON object!`);
            }
        }

        let message = "";

        const response = await client.callTool({ name: toolName, arguments: parsedArgs });

        if ('content' in response && Array.isArray(response.content)) {
            if (response.isError) throw new Error('MCP tool returned an execution error.');

            message = response.content.map((block: any) => {
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

        } else if ('toolResult' in response) {
            message = typeof response.toolResult === 'string'
                ? response.toolResult
                : JSON.stringify(response.toolResult, null, 2);
        } else {
            message = "Tool executed successfully, but returned an unrecognized format.";
        }

        return { message };
    }
}