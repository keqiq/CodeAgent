import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { getEncoding, Tiktoken } from 'js-tiktoken';
import { ChatFactory } from './apis/chat/chatFactory';
import { ChatProvider, WebSearchMode } from './apis/chat/chatProvider';
import { EmbedFactory } from './apis/embed/embedFactory';
import { Indexer } from './indexing/indexer';
import { WorktreeManager } from './managers/worktreeManager';
import { ChatResponse, ContextManager } from './managers/contextManager';
import { CommandManager } from './managers/commandManager';
import { APIManager } from './managers/apiManager';
import { ToolManager } from './managers/toolManager';
import { MCPManager } from './managers/mcpManager';

declare const console: any;

export class ChatApp implements vscode.WebviewViewProvider {

    private view?: vscode.WebviewView;
    
    private apiManager: APIManager;
    private contextManager: ContextManager;
    private commandManager: CommandManager;
    private worktreeManager: WorktreeManager;
    private toolManager: ToolManager;

    private indexer?: Indexer;

    private aborter: AbortController | null = null;

    constructor(private readonly context: vscode.ExtensionContext, private readonly mcpManager: MCPManager) {
        this.apiManager = new APIManager(context);
        this.apiManager.onDidUpdateStatus(event => this.post(event));

        this.contextManager = new ContextManager(context);
        this.contextManager.onDidUpdateStatus(event => this.post(event));

        this.commandManager = new CommandManager(context);
        this.commandManager.onDidUpdateStatus(event => this.post(event));

        // Don't even activate the extension outside of an active workspace there is no point
        // This is set in package.json in activationEvents
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;

        this.worktreeManager = new WorktreeManager(context, workspaceRoot!);
        this.worktreeManager.onDidUpdateStatus(event => this.post(event));

        this.toolManager = new ToolManager({
            context: this.context,
            apiManager: this.apiManager,
            contextManager: this.contextManager,
            commandManager: this.commandManager,
            worktreeManager: this.worktreeManager,
            mcpManager: this.mcpManager,
            getIndexer: () => this.indexer
        });
        this.toolManager.onDidUpdateStatus(event => this.post(event));
    }

    private async runAgentTurn(provider: string, model: string, effort: string, userMessage: string,): Promise<void> {
        
        this.post({ type: 'startRun', provider: provider, model: model });

        await this.worktreeManager.setup();

        this.aborter = new AbortController();

        let runStatus: 'ok' | 'aborted' | 'error' = 'ok';
        let statusMessage: string | undefined = undefined;

        let providerInstance: ChatProvider | undefined = undefined;

        const serverStateManagment = this.context.globalState.get<boolean>('serverStateManagement') ?? true;
        const enabledWebSearch = this.context.globalState.get<boolean>('webSearchEnabled') ?? false;
        const savedWebMode = this.context.globalState.get<string>('webSearchMode') ?? 'tavily';

        try {
            const apiKey = await this.apiManager.getChatAPIKey(provider);

            const webSearchMode: WebSearchMode = enabledWebSearch ? (savedWebMode as WebSearchMode) : 'none';

            providerInstance = ChatFactory.create(provider, apiKey, webSearchMode);


            this.contextManager.prepareRun(provider);
            this.contextManager.addUserMessage(userMessage);

            let keepGoing = true;
            let turnCount = 0;
            const turnLimit = this.context.globalState.get<number>('turnLimit') ?? 0;

            let previousTurnHadError = false;

            while (keepGoing && (turnLimit === 0 || turnCount < turnLimit)) {
                if (this.aborter.signal.aborted) throw new Error('AbortError');
                turnCount++;

                // TODO: EDGE CASE
                // If we keep the extension open with an valid turnID for too long without sending a new prompt
                // The serverside context will expire...
                const streamGenerator = providerInstance.fetchStream(
                    model,
                    effort,
                    this.contextManager.getLLMContext(),
                    this.contextManager.getTurnID(),
                    serverStateManagment,
                    this.aborter.signal
                );
                let streamResult = await streamGenerator.next();

                let streamStartTime: number | null = null;
                let turnGeneratedTokens = 0;
                let lastSpeedPostTime = 0;

                // Wait for the stream to finish, then run all tools called if any
                while (!streamResult.done) {
                    if (streamResult.value) {
                        const content = streamResult.value.content;

                        if (streamResult.value.type === 'text' || streamResult.value.type === 'thought' || streamResult.value.type === 'tool') {
                            const now = Date.now();
                            if (streamStartTime === null) streamStartTime = now;

                            if (streamResult.value.type === 'text') this.post({ type: 'streamChunk', chunk: content });
                            else if (streamResult.value.type === 'thought') this.post({ type: 'streamThought', chunk: content });

                            // Get live token generation speed
                            turnGeneratedTokens += countChunkTokens(content);
                            const elapsedSeconds =  (now - streamStartTime) / 1000;

                            if (elapsedSeconds > 0.1) {
                                lastSpeedPostTime = now;
                                const tokenPerSecond = (turnGeneratedTokens / elapsedSeconds).toFixed(1);
                                this.post({ type: 'streamSpeed', speed: tokenPerSecond });
                            }
                        }
                        // We update the frontend with server tools immediately
                        // Other parameters might show up later upon completion but it could take a while
                        // Currently only web search
                        else if (streamResult.value.type === 'server_action') {
                            this.post({
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
                this.post({ type: 'streamEnd' });

                // update turn counter for tool pruning, do not prune until error is resolved
                await this.contextManager.updateTurnBoundary(previousTurnHadError);
                previousTurnHadError = false;

                const finalResponse = streamResult.value as ChatResponse;

                if (finalResponse?.tokenUsage) {
                    this.contextManager.recordTokenUsage(finalResponse.tokenUsage);
                    this.contextManager.updateTokenUsage();
                }

                const currentTurnID = finalResponse?.turnID;
                this.contextManager.setTurnID(currentTurnID);
                const functionCalls = this.contextManager.processResponseItems(finalResponse.items);

                const summary = await this.toolManager.executeTools(functionCalls, this.aborter.signal);
                previousTurnHadError = summary.hasErrors;
                keepGoing = summary.shouldContinue;
  
            }

            this.toolManager.finalizeRun();
            this.contextManager.updateTokenUsage();

            // Run complete review any changes
            await this.worktreeManager.displayPatch();

        } catch (e: any) {
            // the idea is to revert back to the previous completed state if the current run was not completed
            this.contextManager.rollback();

            if (e.name === 'AbortError' || e.message?.toLowerCase().includes('abort')) {
                if (providerInstance) await providerInstance.abortStream();
                runStatus = 'aborted';
                statusMessage = 'Execution halted manually';
                // let the agent know we aborted
                this.contextManager.addSystemMessage('The response was canceled by the user.');
            } else {
                runStatus = 'error';
                statusMessage = `Error: ${e.message || String(e)}`;
                console.log(`Error during agent turn: ${formatError(e)}`);
            }

        } finally {
            this.aborter = null;
            this.contextManager.addRunSummary(provider, model, runStatus, statusMessage);

            // Update run counter for tool pruning
            await this.contextManager.updateRunBoundary();

            await this.contextManager.save();

            this.contextManager.estimateCategorizedTokens();

            this.post({ type: 'agentRunComplete', status: runStatus, text: statusMessage });
        }
    }

    // ----------------------------- WEBVIEW ROUTING ----------------------------------- //
    public resolveWebviewView(webviewView: vscode.WebviewView, ctx: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this.getHTML();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {

                case 'webviewReady': {

                    try {
                        await this.contextManager.initialize();

                        const showAllChatModels = this.context.globalState.get<boolean>('showAllChatModels') ?? false;
                        const serverStateManagement = this.context.globalState.get<boolean>('serverStateManagement') ?? true;
                        const turnLimit = this.context.globalState.get<number>('turnLimit') ?? 0;
                        const enabledWebSearch = this.context.globalState.get<boolean>('webSearchEnabled') ?? false;
                        const webSearchMode = this.context.globalState.get<string>('webSearchMode') ?? 'tavily';
                        const ollamaChatPort = this.context.globalState.get<number>('ollamaChatPort') ?? 11434;

                        this.post({
                            type: 'restoreChatSettings',
                            showAll: showAllChatModels,
                            stateful: serverStateManagement,
                            turnLimit: turnLimit,
                            webSearch: enabledWebSearch,
                            searchMode: webSearchMode,
                            ollamaPort: ollamaChatPort
                        });

                        const retrievalCount = this.context.globalState.get<number>('retrievalCount') ?? 10;
                        const debounceTime = this.context.globalState.get<number>('debounceTime') ?? 10;
                        const enabledIndex = this.context.globalState.get<boolean>('enableIndex') ?? true;
                        const ollamaEmbedPort = this.context.globalState.get<number>('ollamaEmbedPort') ?? 11434;

                        this.post({
                            type: 'restoreIndexSettings',
                            retrievalCount: retrievalCount,
                            debounceTime: debounceTime,
                            enabled: enabledIndex,
                            ollamaPort: ollamaEmbedPort
                        });

                        this.post({ type: 'initChatProviders', providers: ChatFactory.getAvailableProviders() });
                        this.post({ type: 'initEmbedProviders', providers: EmbedFactory.getAvailableProviders() });

                        this.post({ type: 'restoreChatHistory', history: this.contextManager.getHistory() });


                        const chatProvider = this.context.globalState.get<string>('chatProvider');
                        if (chatProvider) {
                            const stateManagementSupport = ChatFactory.supportsStateManagement(chatProvider);
                            const serverWebSearchSupport = ChatFactory.supportsServerWebSearch(chatProvider);
                            this.post({
                                type: 'updateChatProvider',
                                provider: chatProvider,
                                stateful: stateManagementSupport,
                                serverSearch: serverWebSearchSupport
                            });
                            this.contextManager.estimateCategorizedTokens();
                        }

                        const pruneMode = this.context.globalState.get<string>('pruneMode') ?? 'run';
                        const pruneTurnInterval = this.context.globalState.get<number>('pruneTurnInterval') ?? 3;
                        const pruneRunInterval = this.context.globalState.get<number>('pruneRunInterval') ?? 1;

                        this.post({
                            type: 'restorePruneSettings',
                            mode: pruneMode,
                            turnInterval: pruneTurnInterval,
                            runInterval: pruneRunInterval
                        });

                        const indexEnabled = this.context.globalState.get<boolean>('indexEnabled') ?? false;

                        if (indexEnabled) {
                            const embedProvider = this.context.globalState.get<string>('embedProvider');
                            this.post({ type: 'updateEmbedProvider', provider: embedProvider });
                        }

                        await this.worktreeManager.displayPatch();
                        
                        const agentMode = this.context.workspaceState.get<string>('agentMode') ?? 'manual';
                        this.post({ type: 'restoreAgentMode', mode: agentMode });

                        await this.commandManager.loadConfig();
                        const currentConfig = this.commandManager.getConfig();
                        this.post({ 
                            type: 'updateUnsafeFlag', 
                            isUnsafe: currentConfig?.unsafeFullAutonomous ?? false 
                        });

                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to restore state ${e}`);
                    }
                    break;
                }

                case 'saveOllamaChatPort': {
                    await this.apiManager.saveChatAPIKey('ollama', data.port);
                    await this.apiManager.getChatModels('ollama');

                    break;
                }

                // Called after selecting chat provider from dropdown
                case 'saveChatProvider': {
                    this.apiManager.saveChatProvider(data.provider);
                    this.contextManager.changeProvider(data.provider);
                    this.contextManager.estimateCategorizedTokens();
                    break;
                }


                // Called when pressing the key button or when provider is selected without valid API key
                // Respond with list of models from provider if the key is valid
                case 'saveChatAPIKey': {
                    await this.apiManager.saveChatAPIKey(data.provider, data.key);
                    await this.apiManager.getChatModels(data.provider);
                    break;
                }

                // Called after updateChatProvider and having a valid API key
                // Respond with curated list of models from provider, or all chat models if fetchall is set 
                case 'fetchChatModels': {
                    await this.apiManager.getChatModels(data.provider);
                    break;
                }

                // Called when selecting a new chat model from dropdown
                case 'saveChatModel': {
                    this.apiManager.saveChatModel(data.provider, data.model);
                    break;
                }

                // Called after updateChatModel, fetch model information
                case 'fetchChatModelInfo': {
                    this.apiManager.getChatModelInfo(data.model);
                    break;
                }

                // Effort is save per provider per model, and selected by default on reload
                case 'saveChatEffort': {
                    await this.context.globalState.update(`${data.provider}_${data.model}_Effort`, data.effort);
                    break;
                }

                // Switch between curated list of models or all chat models
                case 'setShowAllModels': {
                    await this.context.globalState.update('showAllChatModels', data.showAll);
                    const chatProvider = this.context.globalState.get<string>('chatProvider');
                    if (chatProvider) await this.apiManager.getChatModels(chatProvider);
                    break;
                }

                // Switch between server side or local context history
                // Only for OpenAI's responses API or Gemini's interactions API
                case 'setStateManagement': {
                    await this.context.globalState.update('serverStateManagement', data.stateful);
                    break;
                }

                case 'updateTurnLimit': {
                    await this.context.globalState.update('turnLimit', data.limit);
                    break;
                }

                case 'saveTavilyAPIKey': {
                    await this.apiManager.saveTavilyAPIKey(data.key);
                    break;
                }

                case 'setWebSearchMode': {
                    await this.context.globalState.update('webSearchEnabled', data.enabled);
                    await this.context.globalState.update('webSearchMode', data.mode);
                    if (data.enabled && data.mode === 'tavily') {
                        const tavilyAPIKey = await this.context.secrets.get('TAVILY_API_KEY');

                        try {
                            await this.apiManager.verifyTavilyAPIKey(tavilyAPIKey);
                        } catch (e) {
                            vscode.window.showErrorMessage('Invalid Tavily API key');
                            this.post({ type: 'requestTavilyAPIKey' });
                        }
                    }
                    break;
                }

                case 'setPruneMode': {
                    await this.context.globalState.update('pruneMode', data.mode);
                    break;
                }

                case 'setPruneInterval': {
                    if (data.turn) await this.context.globalState.update('pruneTurnInterval', data.turn);
                    else if (data.run) await this.context.globalState.update('pruneRunInterval', data.run);
                    break;
                }

                case 'askAgent': {
                    if (!data.value) { return; }
                    this.runAgentTurn(data.provider, data.model, data.effort, data.value);
                    break;
                }

                // Cancel ongoing response
                case 'cancelGeneration': {
                    if (this.aborter) this.aborter.abort();
                    break;
                }

                case 'clearChat': {
                    await this.contextManager.clear();

                    await this.worktreeManager.cleanup();

                    this.post({ type: 'clearChatContainer' });
                    break;
                }

                case 'saveOllamaEmbedPort': {
                    await this.apiManager.saveEmbedAPIKey('ollama', data.port);
                    await this.apiManager.getEmbedModels('ollama');
                    break;
                }

                // Called when selecting a new provider in embedding provider dropdown
                case 'saveEmbedProvider': {
                    await this.apiManager.saveEmbedProvider(data.provider);
                    break;
                }

                // Called after saveEmbedProvider and having a valid API key
                // Respond with a list of embedding models from the provider
                case 'fetchEmbedModels': {
                    await this.apiManager.getEmbedModels(data.provider);
                    break;
                }

                // Called when selecting a new embedding model from the dropdown
                case 'saveEmbedModel': {
                    await this.apiManager.saveEmbedModel(data.provider, data.model);
                    break;
                }
                case 'saveEmbedAPIKey': {
                    await this.apiManager.saveEmbedAPIKey(data.provider, data.key);
                    await this.apiManager.getEmbedModels(data.provider);
                    break;
                }

                // Called after selecting an embedding model
                // Checks if a table for the model already exists and broadcast index status
                case 'loadVectorDB': {
                    // Clear the old indexer if we have one
                    if (this.indexer) this.indexer.dispose();

                    this.indexer = await Indexer.create(this.context, data.model, (provider: string) => this.apiManager.getEmbedAPIKey(provider));
                    this.indexer.onDidUpdateStatus(event => this.post(event));
                    await this.indexer.broadcastCurrentState();
                    break;
                }

                case 'updateVectorCount': {
                    await this.context.globalState.update('retrievalCount', data.value);
                    break;
                }

                case 'updateDebounceTime': {
                    await this.context.globalState.update('debounceTime', data.value);
                    break;
                }

                case 'updateIndexEnabled': {
                    await this.context.globalState.update('indexEnabled', data.enabled);
                    break;
                }

                case 'indexWorkspace': {
                    if (!this.indexer) return;
                    const apiKey = await this.apiManager.getEmbedAPIKey(data.provider);

                    const embedProvider = EmbedFactory.create(data.provider, apiKey);

                    await this.indexer.indexWorkspace(embedProvider, data.model);
                    break;
                }

                case 'deleteIndex': {
                    if (!this.indexer) return;
                    await this.indexer.deleteIndex();
                    break;
                }

                // Take the changes from worktree and apply to main workspace
                case 'applyChanges': {
    
                    try {
                        await this.worktreeManager.applyPatch();

                        this.contextManager.addSystemMessage('The user applied your proposed changes to the workspace');
                        await this.contextManager.save();

                    } catch (e: any) {
                        if (e.message !== 'MERGE_CONFLICT') {
                            // Unexpected error
                            vscode.window.showErrorMessage(`Failed to apply patch: ${e.message || String(e)}`);
                        }
                    }
                    break;
                }

                // Discard worktree
                case 'discardChanges': {
                    await this.worktreeManager.rejectPatch();

                    this.contextManager.addSystemMessage(
                        'The user discarded your proposed changes. Workspace is reverted to last applied changes or original state.'
                    );
                    await this.contextManager.save();
                    break;
                }

                // After resolving merge conflicts
                case 'markResolved': {
                    await this.worktreeManager.resolveConflicts();

                    this.contextManager.addSystemMessage('The user resolved merge conflicts and applied the changes.');
                    await this.contextManager.save();
                    break;
                }

                // Forcing the patch by replacing the files in the main workspace
                case 'forceApplyPatch': {
                    try {
                        await this.worktreeManager.forceApply();

                        this.contextManager.addSystemMessage('The user force-applied your changes, overwriting their local edits.');
                        await this.contextManager.save();
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to force apply: ${e}`);
                    }
                    break;
                }

                case 'openDiffView': {
                    if (this.worktreeManager) {
                        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                        if (!workspaceRoot) return;

                        const originalUri = vscode.Uri.file(path.join(workspaceRoot, data.file));
                        const worktreeUri = vscode.Uri.file(path.join(this.worktreeManager.worktreePath, data.file));

                        if (data.isNew) {
                            // File doesn't exist in original workspace, just open the new proposed file
                            vscode.commands.executeCommand('vscode.open', worktreeUri, { preview: true });
                        } else if (data.isDeleted) {
                            // File doesn't exist in the worktree, just open the original file so they can see what is being removed
                            vscode.commands.executeCommand('vscode.open', originalUri, { preview: true });
                            vscode.window.showInformationMessage(`${data.file} is marked for deletion.`);
                        } else {
                            // Normal diff for modified files
                            const title = `${data.file} (Agent Proposal)`;
                            vscode.commands.executeCommand('vscode.diff', originalUri, worktreeUri, title);
                        }
                    }
                    break;
                }

                case 'setAgentMode': {
                    await this.context.workspaceState.update('agentMode', data.mode);

                    if (data.mode === 'auto') {
                        const hasSeenWarning = this.context.workspaceState.get<boolean>('hasSeenAutoWarning');

                        if (!hasSeenWarning) {
                            await this.context.workspaceState.update('hasSeenAutoWarning', true);

                            vscode.window.showWarningMessage(
                                'Auto Mode enabled. The agent can now execute terminal commands without confirmation. Review the list of allowed commands.',
                                'Understood'
                            );

                            await this.commandManager.openConfigFile();
                        }
                    }
                    break;
                }

                case 'openAgentConfig': {
                    await this.commandManager.openConfigFile();
                    break;
                }

                case 'commandApprovalResponse': {
                    await this.commandManager.receiveApproval(data.requestId, data.approved, data.save);
                    break;
                }
            }
        });
    }

    private post(message: any) { this.view?.webview.postMessage(message); }

    private getHTML(): string {
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'chat.html');
        const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'chat.bundle.js');
        const cssPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'chat.bundle.css');

        try {
            let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');

            const scriptUri = this.view!.webview.asWebviewUri(scriptPath);
            const styleUri = this.view!.webview.asWebviewUri(cssPath);

            html = html.replace('{{styleUri}}', styleUri.toString());
            html = html.replace('{{scriptUri}}', scriptUri.toString());

            return html;
        } catch (e) {
            vscode.window.showErrorMessage(`Error loading frontend html: ${e}`);
            return `<!DOCTYPE html><html><body>Error loading UI</body></html>`;
        }
    }
}

function formatError(e: unknown): string {
    if (e instanceof Error) {
        return e.stack ?? e.message;
    }

    return String(e);
}

let tiktokenEncoder: Tiktoken = getEncoding('o200k_base');
function countChunkTokens(text: string): number {
    try {
        return tiktokenEncoder.encode(text).length;
    } catch {
        return Math.max(1, Math.round(text.length / 3.8));
    }
}