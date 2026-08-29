import * as vscode from 'vscode';
import { APIManager } from '../managers/apiManager';
import { CommandManager } from '../managers/commandManager';
import { MCPManager } from '../managers/mcpManager';
import { Indexer } from '../indexing/indexer';
import { ChatResponse, ContextManager } from '../managers/contextManager';
import { WorktreeManager } from '../managers/worktreeManager';
import { ToolManager } from '../managers/toolManager';
import { ChatProvider, WebSearchMode } from '../apis/chat/chatProvider';
import { ChatFactory } from '../apis/chat/chatFactory';
import { countTokens } from '../utils/tokenizer';

export interface SessionMetadata {
    id: string;
    title: string;
    createdAt: number;
    updatedAt: number;
    customTitle: boolean;
}

export interface SessionAPIConfig {
    provider: string;
    providerModelConfig: Record<string, string>;
    modelEffortConfig: Record<string, string>;
}

export interface SessionPreferences {
    showAll: boolean;
    stateful: boolean;
    turnLimit: number;
    webSearchEnabled: boolean;
    webSearchMode: string;
    pruneMode: string;
    pruneTurnInterval: number;
    pruneRunInterval: number;
    agentMode: string;
}

export interface SessionConfigFile {
    apiConfig: SessionAPIConfig;
    preferences: SessionPreferences;
}

export interface SharedSessionDeps {
    context: vscode.ExtensionContext;
    apiManager: APIManager;
    commandManager: CommandManager;
    mcpManager: MCPManager;
    workspaceRoot: string;
    getIndexer: () => Indexer | undefined
}

export class AgentSession {
    public readonly contextManager: ContextManager;
    public readonly worktreeManager: WorktreeManager;
    public readonly toolManager: ToolManager;

    private aborter: AbortController | null = null;
    private emitter = new vscode.EventEmitter<any>();
    public readonly onDidUpdateStatus = this.emitter.event;

    private readonly configUri: vscode.Uri;

    constructor(
        public metadata: SessionMetadata,
        public apiConfig: SessionAPIConfig,
        public preferences: SessionPreferences,
        private readonly shared: SharedSessionDeps
    ) {

        this.configUri = vscode.Uri.joinPath(shared.context.storageUri!, 'sessions', this.metadata.id, 'config.json');

        // Each session keeps track of it's own context
        this.contextManager = new ContextManager(shared.context, this.metadata, this.apiConfig, this.preferences);
        this.contextManager.onDidUpdateStatus(event => this.emitter.fire(event));

        // Each session gets a separate worktree for concurrent edits
        // Up to the user for merge conflicts for now
        this.worktreeManager = new WorktreeManager(shared.context, shared.workspaceRoot, this.metadata);
        this.worktreeManager.onDidUpdateStatus(event => this.emitter.fire(event));

        // Each session gets a separate tool manager for concurrent tool calls
        // This should be fine (i think) since tools operate within their respective worktrees
        this.toolManager = new ToolManager({
            context: shared.context,
            metadata: this.metadata,
            apiManager: shared.apiManager,
            contextManager: this.contextManager,
            commandManager: shared.commandManager,
            worktreeManager: this.worktreeManager,
            mcpManager: shared.mcpManager,
            getIndexer: shared.getIndexer
        });
        this.toolManager.onDidUpdateStatus(event => this.emitter.fire(event));
    }

    public async initialize(): Promise<void> {
        await this.contextManager.initialize();
    }

    public getAPIConfig(): [provider: string, model: string | undefined, effort: string | undefined] {
        const provider = this.apiConfig.provider;
        const model = this.apiConfig.providerModelConfig[provider];
        const effort = model ? this.apiConfig.modelEffortConfig[model] : undefined;

        return [provider, model, effort];
    }

    public async saveChatProvider(provider: string): Promise<void> {
        this.apiConfig.provider = provider;
        await this.saveConfig();
        await this.shared.apiManager.saveChatProvider(provider, this.metadata.id);
    }

    public async saveChatModel(model: string): Promise<void> {
        const provider = this.apiConfig.provider;
        this.apiConfig.providerModelConfig[provider] = model;
        await this.saveConfig();
        await this.shared.apiManager.saveChatModel(provider, model, this.metadata.id);
    }

    public async saveChatModelEffort(effort: string): Promise<void> {
        const provider = this.apiConfig.provider;
        const model = this.apiConfig.providerModelConfig[provider];
        if (!model) return;
        this.apiConfig.modelEffortConfig[model] = effort.toLowerCase();
        await this.saveConfig();
        await this.shared.apiManager.saveChatModelEffort(model, effort, this.metadata.id);
    }

    public async saveConfig(): Promise<void> {
        const fileContent = {
            apiConfig: this.apiConfig,
            preferences: this.preferences
        };

        const data = new TextEncoder().encode(JSON.stringify(fileContent, null, 2));
        await vscode.workspace.fs.writeFile(this.configUri, data);
    }

    public isRunning(): boolean {
        return this.aborter !== null;
    }

    public abort(): void {
        if (this.aborter) this.aborter.abort;
    }

    public async runAgentTurn(userMessage: string): Promise<void> {
        this.aborter = new AbortController();

        // Auto generate title if we currently have the default title
        if (!this.metadata.customTitle) this.generateTitle(userMessage); // non blocking!

        await this.worktreeManager.clearState();
        await this.worktreeManager.setup();
        const provider = this.apiConfig.provider || '';
        const model = this.apiConfig.providerModelConfig[provider] || '';
        const effort = this.apiConfig.modelEffortConfig[model];
        const serverStateManagement = this.preferences.stateful;
        const webSearchMode: WebSearchMode = this.preferences.webSearchEnabled 
            ? (this.preferences.webSearchMode as WebSearchMode) 
            : 'none';
        const turnLimit = this.preferences.turnLimit;

        await this.worktreeManager.setup();
        const apiKey = await this.shared.apiManager.getChatAPIKey(provider);
        const providerInstance: ChatProvider = ChatFactory.create(provider, apiKey, webSearchMode);

        let runStatus: 'ok' | 'aborted' | 'error' = 'ok';
        let statusMessage: string | undefined = undefined;

        try {
            let keepGoing = true;
            let turnCount = 0;

            this.emitter.fire({ type: 'toggleChatControls', disabled: true });
            this.emitter.fire({ type: 'startRun', provider: provider, model: model });

            this.contextManager.prepareRun(provider);
            this.contextManager.addUserMessage(userMessage);

            let previousTurnHadError = false;

            while (keepGoing && (turnLimit === 0 || turnCount < turnLimit)) {
                if (this.aborter.signal.aborted) throw new Error('AbortError');
                turnCount++;

                this.emitter.fire({ type: 'updateTurnProgress', current: turnCount, limit: turnLimit });

                // Disable all tool use during the final turn
                const isFinalTurn = turnLimit > 0 && turnCount === turnLimit;

                // TODO: EDGE CASE
                // If we keep the extension open with an valid turnID for too long without sending a new prompt
                // The serverside context will expire...
                const streamGenerator = providerInstance.fetchStream(
                    model,
                    effort!,
                    this.contextManager.getLLMContext(),
                    this.contextManager.getTurnID(),
                    serverStateManagement,
                    this.aborter.signal,
                    isFinalTurn
                );
                let streamResult = await streamGenerator.next();

                let streamStartTime: number | null = null;
                let turnGeneratedTokens = 0;

                // Wait for the stream to finish, then run all tools called if any
                while (!streamResult.done) {
                    if (streamResult.value) {
                        const content = streamResult.value.content;

                        if (streamResult.value.type === 'text' || streamResult.value.type === 'thought' || streamResult.value.type === 'tool') {
                            const now = Date.now();
                            if (streamStartTime === null) streamStartTime = now;

                            if (streamResult.value.type === 'text') {
                                this.emitter.fire({ type: 'streamChunk', chunk: content }); 
                            }

                            else if (streamResult.value.type === 'thought') {
                                this.emitter.fire({ type: 'streamThought', chunk: content });
                            }

                            // Get live token generation speed
                            turnGeneratedTokens += countTokens(content);
                            const elapsedSeconds = (now - streamStartTime) / 1000;

                            if (elapsedSeconds > 0.1) {
                                const tokenPerSecond = (turnGeneratedTokens / elapsedSeconds).toFixed(1);
                                this.emitter.fire({ type: 'streamSpeed', speed: tokenPerSecond });
                            }
                        }
                        // We update the frontend with server tools immediately
                        // Other parameters might show up later upon completion but it could take a while
                        // Currently only web search
                        else if (streamResult.value.type === 'server_action') {
                            this.emitter.fire({
                                type: 'updateTool',
                                status: 'running',
                                toolId: streamResult.value.actionId, // Keep track of tool id, server tools can run in parallel
                                toolName: streamResult.value.actionName,
                                args: { query: streamResult.value.actionQuery || 'Searching the web...' }
                            });
                        }
                    }
                    streamResult = await streamGenerator.next();
                }

                // Can't catch the abort error during streaming for some reason so we have to catch it here again
                if (this.aborter.signal.aborted) throw new Error('AbortError');
                this.emitter.fire({ type: 'streamEnd' });

                // update turn counter for tool pruning, do not prune until error is resolved
                await this.contextManager.updateTurnBoundary(previousTurnHadError);
                previousTurnHadError = false;

                const finalResponse = streamResult.value as ChatResponse;

                if (finalResponse?.tokenUsage) {
                    this.contextManager.recordTokenUsage(finalResponse.tokenUsage);
                    this.contextManager.updateTokenUsage();
                }
                this.contextManager.estimateCategorizedTokens();

                const currentTurnID = finalResponse?.turnID;
                this.contextManager.setTurnID(currentTurnID);
                const functionCalls = this.contextManager.processResponseItems(finalResponse.items);

                const summary = await this.toolManager.executeTools(functionCalls, this.aborter.signal);
                previousTurnHadError = summary.hasErrors;
                keepGoing = summary.shouldContinue;

                // Remind the agent of turn budget!
                if (keepGoing && turnLimit > 0) this.contextManager.addTurnReminder(turnCount, turnLimit);
            }

            this.toolManager.finalizeRun();
            this.contextManager.updateTokenUsage();

            // Run complete review any changes
            await this.worktreeManager.displayPatch();

        } catch (e: any) {
            // the idea is to revert back to the previous completed state if the current run was not completed
            this.contextManager.rollback();

            if (e.name === 'AbortError' || e.message?.toLowerCase().includes('abort')) {
                if (providerInstance) await providerInstance.abortGeneration();
                runStatus = 'aborted';
                statusMessage = 'Execution halted manually';
                // let the agent know we aborted
                this.contextManager.addSystemMessage('The response was canceled by the user.');
            } else {
                runStatus = 'error';
                statusMessage = `Error: ${e.message || String(e)}`;
            }

        } finally {
            this.aborter = null;
            this.contextManager.addRunSummary(provider, model, runStatus, statusMessage);

            // Update run counter for tool pruning
            await this.contextManager.updateRunBoundary();

            await this.contextManager.save();

            this.contextManager.estimateCategorizedTokens();

            // Bump session timestamp in manifest
            this.emitter.fire({ type: 'updateManifest' });

            this.emitter.fire({ type: 'endRun', status: runStatus, text: statusMessage });

            this.emitter.fire({ type: 'toggleChatControls', disabled: false });
        }
    }

    public async runCompaction(): Promise<void> {
        this.aborter = new AbortController();
        const provider = this.apiConfig.provider || '';
        const model = this.apiConfig.providerModelConfig[provider];
        
        if (!provider || !model) throw new Error('Model not configured!');

        const chatAPIKey = await this.shared.apiManager.getChatAPIKey(provider);
        const providerInstance = ChatFactory.create(provider, chatAPIKey, 'none');

        const compactionStartIndex = this.contextManager.getHistory().length;
        let runStatus: 'ok' | 'aborted' | 'error' = 'ok';
        let statusMessage: string | undefined = undefined;

        try {
            this.emitter.fire({ type: 'toggleChatControls', disabled: true });
            this.emitter.fire({ type: 'startRun', provider: provider, model: model, isSummary: true });

            this.contextManager.prepareRun(provider);
            this.contextManager.addUserMessage(ChatFactory.getCompactionPrompt(provider));

            let keepGoing = true;
            while (keepGoing) {
                if (this.aborter.signal.aborted) throw new Error('AbortError');

                const response = await providerInstance.summarizeContext(
                    model,
                    this.contextManager.getLLMContext(),
                    this.contextManager.getTurnID(),
                    this.aborter.signal
                );

                if (response.tokenUsage) {
                    this.contextManager.recordTokenUsage(response.tokenUsage);
                    this.contextManager.updateTokenUsage();
                }

                const currentTurnID = response.turnID;
                this.contextManager.setTurnID(currentTurnID);

                const functionCalls = this.contextManager.processResponseItems(response.items);
                const summary = await this.toolManager.executeTools(functionCalls, this.aborter.signal);
                keepGoing = summary.shouldContinue;
            }

            this.toolManager.finalizeRun();
            await this.contextManager.compactContext(compactionStartIndex);

        } catch (e: any) {
            this.contextManager.rollback();
            this.contextManager.compactionCleanup(compactionStartIndex);
            if (e.name === 'AbortError' || e.message?.toLowerCase().includes('abort')) {
                if (providerInstance) await providerInstance.abortGeneration();
                runStatus = 'aborted';
                statusMessage = 'Compaction Halted';
            } else {
                runStatus = 'error';
                statusMessage = `Error: ${e.message || String(e)}`;
            }
        } finally {
            this.aborter = null;
            this.contextManager.addRunSummary(provider, model, runStatus, statusMessage);
            await this.contextManager.save();

            // Bump session timestamp in manifest
            this.emitter.fire({ type: 'updateManifest' });

            this.emitter.fire({ type: 'endRun', status: runStatus, text: statusMessage });

            this.emitter.fire({ type: 'toggleChatControls', disabled: false });
        }
    }

    public async generateTitle(firstUserPrompt: string): Promise<void> {

        this.emitter.fire({ type: 'titleGenerating', isGenerating: true });
        try {
            const provider = this.apiConfig.provider;
            if (!provider) throw new Error ('Unconfigured provider');
            const activeModel = this.apiConfig.providerModelConfig[provider];

            const apiKey = await this.shared.apiManager.getChatAPIKey(provider);
            const providerInstance = ChatFactory.create(provider, apiKey, 'none');

            // Use designated summary model or fallback to current active model
            const summaryModel = ChatFactory.getSummaryModel(provider) || activeModel;

            const generatedTitle = await providerInstance.generateTitle(firstUserPrompt, summaryModel);
            if (generatedTitle) {
                this.metadata.title = generatedTitle;
                this.metadata.updatedAt = Date.now();
                this.metadata.customTitle = true;

                this.emitter.fire({
                    type: 'updateManifest',
                    title: generatedTitle,
                    customTitle: true
                });
            }
        } catch (e) {
            console.warn(`Failed to auto-generate chat title: ${e}`);

            this.emitter.fire({ type: 'titleGenerating', isGenerating: false });
        }
    }
    
    public async cleanup(): Promise<void> {
        this.abort();
        await this.worktreeManager.cleanup();
    }
}
