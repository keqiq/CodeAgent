import * as vscode from 'vscode';
import { createToolRegistry, ToolResult } from '../tools/toolIndex';
import { EmbedFactory } from '../apis/embed/embedFactory';
import { Indexer } from '../indexing/indexer';
import { WorktreeManager } from './worktreeManager';
import { ContextManager, FunctionCallItem } from './contextManager';
import { CommandManager } from './commandManager';
import { APIManager } from './apiManager';
import { MCPManager } from './mcpManager';
import { SessionMetadata } from '../session/agentSession';

export interface ToolManagerDependencies {
    context: vscode.ExtensionContext;
    metadata: SessionMetadata;
    apiManager: APIManager;
    contextManager: ContextManager;
    commandManager: CommandManager;
    worktreeManager: WorktreeManager;
    mcpManager: MCPManager
    getIndexer: () => Indexer | undefined;
}

export interface ToolExecutionSummary {
    hasErrors: boolean;
    shouldContinue: boolean;
}

export class ToolManager {
    private toolRegistry: Record<string, Function>;
    private activeSignal: AbortSignal | null = null;
    private emitter = new vscode.EventEmitter();
    public readonly onDidUpdateStatus = this.emitter.event;

    private totalCustomTools = 0;
    private totalServerTools = 0;
    private totalExecuteRun = 0;


    constructor(private readonly deps: ToolManagerDependencies) {
        this.toolRegistry = this.initializeRegistry();
    }

    private initializeRegistry(): Record<string, Function> {
        return createToolRegistry({
            getCwd: () => {
                if (this.deps.worktreeManager?.worktreePath) {
                    return this.deps.worktreeManager.worktreePath;
                }
                const root = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
                if (!root) throw new Error('No active workspace');
                return root;
            },

            getSignal: () => {
                if (!this.activeSignal) {
                    throw new Error('No active turn signal available');
                }
                return this.activeSignal;
            },

            getFindDeps: async () => {
                const { context, apiManager, getIndexer } = this.deps;
                const provider = context.globalState.get<string>('embedProvider');
                const model = context.globalState.get<string>(`${provider}_embedModel`);
                const indexer = getIndexer();

                if (!provider || !model) throw new Error('Embedding provider/model is not configured');
                if (!indexer) throw new Error('Index is not loaded. Enable indexing first.');
                if (!indexer.indexEnabled()) throw new Error('Indexing is disabled cannot use semantic search');

                const apiKey = await apiManager.getEmbedAPIKey(provider);

                return {
                    indexer,
                    embedProvider: EmbedFactory.create(provider, apiKey),
                    model
                };
            },

            getWebDeps: async () => {
                const { context } = this.deps;
                const webSearchEnabled = context.globalState.get<boolean>('webSearchEnabled') ?? false;
                const webSearchMode = context.globalState.get<string>('webSearchMode') ?? 'tavily';

                if (!webSearchEnabled || webSearchMode !== 'tavily') {
                    throw new Error("You do not have access to the 'web' tool this turn. It is currently disabled.");
                }

                const tavilyAPIKey = await context.secrets.get('TAVILY_API_KEY');
                if (!tavilyAPIKey) throw new Error('Tavily API key not configured!');
                return tavilyAPIKey;
            },

            getContextManager: () => this.deps.contextManager,

            getCommandManager: () => this.deps.commandManager,

            getMCPManager: () => this.deps.mcpManager,

            getSessionID: () => this.deps.metadata.id,
        });
    }

    public async executeTools(toolCalls: FunctionCallItem[], signal: AbortSignal): Promise<ToolExecutionSummary> {

        if (toolCalls.length === 0) return {hasErrors: false, shouldContinue: false};
        this.activeSignal = signal;
        let hasErrors = false;
        let customToolsRun = 0;

        try {

            for (const toolCall of toolCalls) {
                if (signal.aborted) throw new Error('AbortError');

                const { id: toolID, name: toolName, arguments: toolArgs, server: isServer } = toolCall;

                // Do not process server side tools, just let ui know it's happening
                if (isServer) {
                    this.totalServerTools++;
                    this.emitter.fire({
                        type: 'updateTool',
                        status: 'server',
                        toolID: toolID,
                        toolName,
                        args: toolArgs
                    });
                    continue;
                }

                customToolsRun++;
                this.totalCustomTools++;
                const isExecute = toolName === 'run';
                const uiType = isExecute ? 'updateExecute' : 'updateTool';

                let bin = toolName;
                let argsString = '';

                if (isExecute) {
                    this.totalExecuteRun++;
                    if (toolArgs.command) {
                        const parts = toolArgs.command.trim().split(/\s+/);
                        bin = parts[0];
                        argsString = parts.slice(1).join(' ');
                    }
                }

                this.emitter.fire({
                    type: uiType,
                    status: 'running',
                    toolID,
                    toolName,
                    args: toolArgs,
                    bin,
                    argsString
                });

                let result: ToolResult;
                let isError = false;

                // Built in tool, including MCP tools
                if (this.toolRegistry[toolName]) {
                    try {
                        result = await this.toolRegistry[toolName](toolArgs, toolID);
                        this.emitter.fire({ type: uiType, status: 'success', toolID: toolID });

                    } catch (e) {
                        isError = true;
                        hasErrors = true;
                        const message = e instanceof Error ? e.message : String(e);
                        result = { message: `Error executing ${toolName}: ${message}` };
                        this.emitter.fire({ type: uiType, status: 'error', toolID: toolID, error: message });
                    }
                }
                // Tool not found in registry or connected MCP servers
                else {
                    isError = true;
                    hasErrors = true;
                    result = { message: `Error: tool '${toolName}' is not registered.`};
                    this.emitter.fire({ type: 'updateTool', status: 'error', toolID: toolID, error: 'Invalid tool call.' });
                }

                this.deps.contextManager.addFunctionResult(toolID, toolName, result.message, isError, result.data);
            }

            // Only continue loop if we have custom tool results to feed back into the model
            return {
                hasErrors,
                shouldContinue: customToolsRun > 0
            };

        } finally {
            this.activeSignal = null;
        }
    }

    public finalizeRun(): void {
        if (this.totalCustomTools > 0 || this.totalServerTools > 0) {
            this.emitter.fire({
                type: 'endTools',
                customCount: this.totalCustomTools - this.totalExecuteRun,
                serverCount: this.totalServerTools
            });
        }

        if (this.totalExecuteRun > 0) {
            this.emitter.fire({ type: 'endExecute' });
        }

        // Reset counters for the next run
        this.totalCustomTools = 0;
        this.totalServerTools = 0;
        this.totalExecuteRun = 0;
    }
}