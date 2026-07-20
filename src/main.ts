import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { ChatFactory } from './apis/chat/chatFactory';
import { ChatItem, ChatResponse, ModelInfo } from './apis/chat/chatProvider';
import { createToolRegistry, ToolResult } from './tools/toolIndex';
import { EmbedFactory } from './apis/embed/embedFactory';
import { Indexer } from './indexing/indexer';
import { getEmbedModelsFromProvider, getChatModelsFromProvider } from './utils/apiUtils';
import { WorktreeManager } from './worktreeManager';

declare const console: any;

interface ActiveTurnState {
    provider: string;
    turnID: string | undefined;
}

export class ChatApp implements vscode.WebviewViewProvider {

    private view?: vscode.WebviewView;
    
    private chatHistory: ChatItem[];
    private toolRegistry: any;
    private chatModelInfo: Map<string, ModelInfo> = new Map();
    
    private indexer? : Indexer;

    private activeTurn: ActiveTurnState = { provider: '', turnID: undefined};

    private activeWorktree? : WorktreeManager;

    private aborter: AbortController | null = null;
    
    constructor(private readonly context: vscode.ExtensionContext) {
        const savedHistory = context.workspaceState.get<ChatItem[]>('chatHistory');
        
        if (savedHistory && savedHistory.length > 0) {
            this.chatHistory = savedHistory;
            const lastItemWithId = [...savedHistory].reverse().find(item => item.turnID);
            if (lastItemWithId) this.activeTurn.turnID = lastItemWithId.turnID;
        }
        else this.chatHistory = this.getInitialChatMessages();

        const activeWorktreeID = context.workspaceState.get<string>('activeWorktreeID');
        if (activeWorktreeID) {
            const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
            if (workspaceRoot) this.activeWorktree = new WorktreeManager(workspaceRoot, activeWorktreeID);
        }
        
        this.toolRegistry = createToolRegistry({
            getCwd: () => {
                if (this.activeWorktree) return this.activeWorktree.worktreePath;
                const root = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                if (!root) throw new Error('No active workspace');
                return root;
            },

            getSignal: () => {
                if (!this.aborter) throw new Error('No active turn to get signal from');
                return this.aborter.signal;
            },

            createSearchCodebaseDeps: async () => {
                const provider = this.context.globalState.get<string>('embedProvider');
                const model = this.context.globalState.get<string>(`${provider}_embedModel`);
                
                if (!provider || !model) throw new Error("embedding provider/model is not configured");
                if (!this.indexer) throw new Error("Index is not loaded. Enable indexing first.");

                const apiKey = await this.getEmbedAPIKey(provider);
                
                return {
                    indexer: this.indexer,
                    embedProvider: EmbedFactory.create(provider, apiKey),
                    model
                };
            }
        });
    }

    private getInitialChatMessages(): ChatItem[] {
        return [{
            type: 'message',
            role: 'developer',
            content: `You are an autonomous, expert software engineering agent integrated into VS Code. 
                      You have access to tools that can search, read, write, and edit files in the user's workspace.
                      When a user asks you to find a bug or fix a problem, DO NOT ask them for the file name if you can search for it yourself. 
                      Proactively use your semantic search tool 'searchCodebase' tool to search the workspace.
                      Tools like 'glob' and 'grep' should be used as a fallback if semantic search fails to return relevant results, or if you need to view files in more detail. 
                      Find the relevant code, read it, and edit it to fix the issue. 
                      Always explain your thought process before executing a tool.`
        }];
    }

    private post(message: any) { this.view?.webview.postMessage(message); }

    private async saveChatHistory() { await this.context.workspaceState.update('chatHistory', this.chatHistory); }

    private async getChatAPIKey(provider: string): Promise<string> {
        const chatSecretKey = `${provider.toUpperCase()}_CHAT_API_KEY`;
        let chatAPIKey = await this.context.secrets.get(chatSecretKey);

        // Fallback to embed api key if embed is not found
        if (!chatAPIKey) {
            const embedSecretKey = `${provider.toUpperCase()}_EMBED_API_KEY`;
            chatAPIKey = await this.context.secrets.get(embedSecretKey);
        }

        // if we have neither chat nor embed apikey, request chat key
        if (!chatAPIKey) {
            this.post({ type: 'requestChatAPIKey', provider: provider });
            throw new Error(`Missing ${provider} API key`);
        }
        return chatAPIKey;
    }

    private async getEmbedAPIKey(provider: string): Promise<string> {
        const embedSecretKey = `${provider.toUpperCase()}_EMBED_API_KEY`;
        let embedAPIKey =  await this.context.secrets.get(embedSecretKey);

        // Fallback to chat api key if embed is not found
        if (!embedAPIKey) {
            const chatSecretKey = `${provider.toUpperCase()}_CHAT_API_KEY`;
            embedAPIKey = await this.context.secrets.get(chatSecretKey);
        }

        // if we have neither chat nor embed apikey, request embedding key
        if (!embedAPIKey) {
            this.post({ type: 'requestEmbedAPIKey', provider: provider });
            throw new Error(`Missing ${provider} API key`);
        }
        return embedAPIKey;
    }

    private async refreshChatModels(provider: string) {
        try {
            this.post({ type: 'setChatModelsLoading', provider: provider });

            const apiKey = await this.getChatAPIKey(provider);

            const fetchALL = this.context.globalState.get<boolean>('showAllChatModels') ?? false;
            const infos = await getChatModelsFromProvider(provider, apiKey, fetchALL);

            this.chatModelInfo.clear();
            infos.forEach((info: ModelInfo) => this.chatModelInfo.set(info.id, info));

            this.post({ type: 'setChatModels', models: infos.map((info: ModelInfo) => info.id) });
            
            const chatModel = this.context.globalState.get<string>(`${provider}_chatModel`);
            const isValidModel = infos.some((info: ModelInfo) => info.id === chatModel);

            this.post({ type: 'updateChatModel', model: isValidModel ? chatModel : undefined });

        } catch(e) {
            vscode.window.showErrorMessage(`Failed to fetch chat models: ${e}`);
            this.post({ type: 'requestChatAPIKey', provider: provider });
        }
    }

    private async refreshEmbedModels(provider: string) {
        try {
            this.post({ type: 'setEmbedModelsLoading', provider: provider });
            
            const apiKey = await this.getEmbedAPIKey(provider);
            const models = await getEmbedModelsFromProvider(provider, apiKey);

            this.post({ type: 'setEmbedModels', models });

            const savedModel = this.context.globalState.get<string>(`${provider}_embedModel`);
            const isValidModel = models.includes(savedModel as any);

            this.post({ type: 'updateEmbedModel', model: isValidModel ? savedModel : undefined });

        } catch (e) {
            vscode.window.showErrorMessage(`Failed to fetch embed models: ${e}`);
            this.post({ type: 'requestEmbedAPIKey', provider: provider });
        }
    }

    private async clearActiveWorktree(): Promise<void> {
        if (this.activeWorktree) {
            await this.activeWorktree.cleanup();
            this.activeWorktree = undefined;
            await this.context.workspaceState.update('activeWorktreeID', undefined);
            await this.context.workspaceState.update('patchStatus', undefined);
        }
    }

    private async runAgentTurn(provider: string, model: string, effort: string, userMessage: string,): Promise<void> {
        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
        if (!workspaceRoot) throw new Error("No active workspace");

        if (!this.activeWorktree) {

            // Check for git, this is a hard requirement
            const gitInstalled = await WorktreeManager.isGitInstalled();
            if (!gitInstalled) {
                vscode.window.showErrorMessage('Install Git on your system and restart VS Code.', 'Understood' );
                return;
            }

            // Check if workspace has version control initialized
            const isRepo = await WorktreeManager.isGitRepo(workspaceRoot);
            if (!isRepo) {
                const userChoice = await vscode.window.showWarningMessage(
                    'Git repository required for file edits. Initialize now?',
                    'Initialize',
                    'Cancel'
                );

                if (userChoice === 'Initialize') {
                    try {
                        await WorktreeManager.initGitRepo(workspaceRoot);
                        vscode.window.showInformationMessage('Git repository initialized successfully.');
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to initialize Git: ${e}`);
                        return;
                    }
                } else {
                    throw new Error("Agent execution cancelled. A Git repository is required.");
                }
            }
            const runID = this.activeTurn.turnID || Date.now().toString();
            this.activeWorktree = new WorktreeManager(workspaceRoot, runID);
            await this.activeWorktree.setup();

            await this.context.workspaceState.update('activeWorktreeID', runID);
        }

        this.aborter = new AbortController();
        const lastValidTurnState: ActiveTurnState = { ...this.activeTurn };

        try {
            const apiKey = await this.getChatAPIKey(provider); 
            const serverStateManagment = this.context.globalState.get<boolean>('serverStateManagement') ?? true;
            
            const providerInstance = ChatFactory.create(provider, apiKey);
            this.chatHistory.push({ type: 'message', role: 'user', content: userMessage, turnID: this.activeTurn.turnID });
            await this.saveChatHistory();
            
            let keepGoing = true;
            let turnCount = 0;
            const turnLimit = this.context.globalState.get<number>('turnLimit') ?? 0;
            
            let hasStartedToolGroup = false;
            let toolsRunThisTurn = 0;
            
            while (keepGoing && (turnLimit === 0 || turnCount < turnLimit)) {
                if (this.aborter.signal.aborted) throw new Error('AbortError');
                turnCount++;
                // Use the ID ONLY if the provider hasn't changed
                const turnID = (this.activeTurn.provider === provider && serverStateManagment) ? this.activeTurn.turnID : undefined;
                const streamGenerator = providerInstance.fetchStream(model, effort, this.chatHistory, turnID, this.aborter.signal);
                let streamResult = await streamGenerator.next();
                
                while (!streamResult.done) {
                    if (streamResult.value) {
                        const content = streamResult.value.content;
                        
                        if (streamResult.value.type === 'text') this.post({ type: 'streamChunk', chunk: content });
                        else if (streamResult.value.type === 'thought') this.post({ type: 'streamThought', chunk: content });
                    }
                    streamResult = await streamGenerator.next();
                }
                
                // Can't catch the abort error during streaming for some reason so we have to catch it here again
                if (this.aborter.signal.aborted) throw new Error('AbortError');
                this.post({ type: 'streamEnd' });
                const finalResponse = streamResult.value as ChatResponse;
                
                if (finalResponse && finalResponse.items.length > 0) this.chatHistory.push(...finalResponse.items);

                const functionCalls = finalResponse?.items.filter(item => item.type === 'function_call') || [];
                const currentTurnID = finalResponse?.turnID;

                if (functionCalls.length > 0) {

                    if (!hasStartedToolGroup) {
                        hasStartedToolGroup = true;
                        this.post({ type: 'startToolGroup' });
                    }

                    for (const toolCall of functionCalls) {
                        if (this.aborter?.signal.aborted) throw new Error('AbortError');
                        toolsRunThisTurn++;
                        const toolName = toolCall.name;
                        const toolArgs = toolCall.arguments;
                        const toolId = toolCall.id;

                        this.post({ type: 'updateTool', status: 'running', toolName: toolName, args: toolArgs });

                        let result: ToolResult;

                        if (this.toolRegistry[toolName]) {
                            try {
                                result = await this.toolRegistry[toolName](toolArgs);
                                this.post({ type: 'updateTool', status: 'success' });
                                // if (result.changedFiles?.length) this.indexer!.scheduleIndex(result.changedFiles);
                            } catch (e) {
                                const message = e instanceof Error ? e.message : String(e);
                                result = { message: `Error executing ${toolName}: ${message}`};
                                this.post({ type: 'updateTool', status: 'error', error: message });
                            }
                        } else {
                            result =  {message: `Error: Tool '${toolName}' is not registered`};
                            this.post({ type: 'updateTool', status: 'error', error: "Invalid tool call" });
                        }

                        this.chatHistory.push({ type: 'function_result', id: toolId, name: toolName, result: result.message, turnID: currentTurnID });
                    }

                } else {
                    keepGoing = false;
                }
                this.activeTurn = { provider: provider, turnID: currentTurnID };
            }

            if (hasStartedToolGroup) this.post({ type: 'endToolGroup', totalCount: toolsRunThisTurn });
            await this.saveChatHistory();

            // Run complete review any changes
            if (!this.aborter.signal.aborted) {
                const patchString = await this.activeWorktree.getPatch();

                if (patchString.trim()) {
                    this.post({ type: 'reviewPatch', patch: patchString });
                }

                // No changes close worktree
                else {
                    await this.clearActiveWorktree();
                }
            }

        } catch (e: any) {
            if (e.name === 'AbortError' || e.message?.toLowerCase().includes('abort')) {
                // If we aborted the response, roll back to previous turnID
                this.activeTurn = lastValidTurnState;
                this.chatHistory.push({ type: 'message', role: 'assistant', content: '🛑 *You stopped this response.*' });
                this.post({ type: 'receiveMessage', text: '🛑 *You stopped this response.*' });
            } else {
                this.chatHistory.push({ type: 'message', role: 'assistant', content: `❌ *Error: ${e.message || String(e)}*` });
                this.post({ type: 'receiveMessage', text: `❌ *Error: ${e.message || String(e)}*` });
            }
            this.saveChatHistory();
            this.post({ type: 'agentRunComplete' });
        } finally {
            this.aborter = null;
            this.post({ type: 'agentRunComplete' });
        }
    }

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

                        const showAllChatModels = this.context.globalState.get<boolean>('showAllChatModels') ?? false;
                        const serverStateManagement = this.context.globalState.get<boolean>('serverStateManagement') ?? true;
                        const turnLimit = this.context.globalState.get<number>('turnLimit') ?? 0;

                        this.post({
                            type: 'restoreChatSettings',
                            showAll: showAllChatModels,
                            stateful: serverStateManagement,
                            turnLimit: turnLimit
                        });

                        const retrievalCount = this.context.globalState.get<number>('retrievalCount') ?? 10;
                        const debounceTime = this.context.globalState.get<number>('debounceTime') ?? 10;
                        const enabledIndex = this.context.globalState.get<boolean>('enableIndex') ?? true;

                        this.post({
                            type: 'restoreIndexSettings',
                            retrievalCount: retrievalCount,
                            debounceTime: debounceTime,
                            enabled: enabledIndex
                        });
                        
                        this.post({ type: 'initChatProviders', providers: ChatFactory.getAvailableProviders() });
                        this.post({ type: 'initEmbedProviders', providers: EmbedFactory.getAvailableProviders() });

                        this.post({ type: 'restoreChatHistory', history: this.chatHistory });
                        
                        const chatProvider = this.context.globalState.get<string>('chatProvider');
                        if (chatProvider) {
                            const stateManagementSupport = ChatFactory.supportsStateManagement(chatProvider);
                            this.post({ type: 'updateChatProvider', provider: chatProvider, stateful: stateManagementSupport });
                        }

                        const indexEnabled = this.context.globalState.get<boolean>('indexEnabled') ?? false;
                        
                        if (indexEnabled) {
                            const embedProvider = this.context.globalState.get<string>('embedProvider');
                            this.post({ type: 'updateEmbedProvider', provider: embedProvider });
                        }

                        if (this.activeWorktree) {
                            const patchString = await this.activeWorktree.getPatch();
                            
                            if (patchString.trim()){
                                this.post({ type: 'reviewPatch', patch: patchString});
                                const currentStatus = this.context.workspaceState.get<string>('patchStatus');
                                if (currentStatus) this.post({ type: 'updatePatchStatus', status: currentStatus }); 
                            }
                            else await this.clearActiveWorktree();

                        }
                    
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to restore state ${e}`);
                    }
                    break;
                }

                // Called after selecting chat provider from dropdown
                case 'saveChatProvider': {
                    await this.context.globalState.update('chatProvider', data.provider);
      
                    const serverStateManagement = this.context.globalState.get<boolean>('serverStateManagement') ?? true;
                    this.post({ type: 'restoreChatSettings', stateful: serverStateManagement});
                    const stateManagementSupport = ChatFactory.supportsStateManagement(data.provider);
                    this.post({ type: 'updateChatProvider', provider: data.provider, stateful: stateManagementSupport });
                    break;
                }
                

                // Called when pressing the key button or when provider is selected without valid API key
                // Respond with list of models from provider if the key is valid
                case 'saveChatAPIKey': {
                    const secretKey = `${data.provider.toUpperCase()}_CHAT_API_KEY`;
                    await this.context.secrets.store(secretKey, data.key);
                    await this.refreshChatModels(data.provider);
                    break;
                }

                // Called after updateChatProvider and having a valid API key
                // Respond with curated list of models from provider, or all chat models if fetchall is set 
                case 'fetchChatModels': {
                    await this.refreshChatModels(data.provider);
                    break;
                }

                // Called when selecting a new chat model from dropdown
                case 'saveChatModel': {
                    await this.context.globalState.update(`${data.provider}_chatModel`, data.model);
                    this.post({ type: 'updateChatModel', model: data.model });
                    break;
                }

                // Called after updateChatModel, fetch model information
                case 'fetchChatModelInfo': {
                    const info = this.chatModelInfo.get(data.model);
                    if (info) {
                        const chatProvider = this.context.globalState.get<string>('chatProvider');
                        const savedEffort = this.context.globalState.get<string>(`${chatProvider}_${data.model}_Effort`);
                        this.post({ 
                            type: 'updateChatModelInfo', 
                            reason: info.reason, 
                            efforts: info.efforts, 
                            defaultEffort: savedEffort ? savedEffort : info.defaultEffort 
                        });
                    }
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
                    if (chatProvider) await this.refreshChatModels(chatProvider);
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
                    this.activeTurn = {provider: '', turnID: undefined};

                    // Restore system prompt and nothing else
                    this.chatHistory = this.getInitialChatMessages();
                    await this.context.workspaceState.update('chatHistory', this.chatHistory);

                    // Close active work tree
                    if  (this.activeWorktree)  await this.clearActiveWorktree();

                    this.post({ type: 'clearChatContainer' });
                    break;
                }
                
                // Called when selecting a new provider in embedding provider dropdown
                case 'saveEmbedProvider': {
                    await this.context.globalState.update('embedProvider', data.provider);
                    this.post({ type: 'updateEmbedProvider', provider: data.provider });
                    break;
                }
                
                // Called after saveEmbedProvider and having a valid API key
                // Respond with a list of embedding models from the provider
                case 'fetchEmbedModels': {
                    await this.refreshEmbedModels(data.provider);
                    break;
                }
                
                // Called when selecting a new embedding model from the dropdown
                case 'saveEmbedModel': {
                    await this.context.globalState.update(`${data.provider}_embedModel`, data.model);
                    this.post({ type: 'updateEmbedModel', model: data.model });
                    break;
                }
                
                case 'saveEmbedAPIKey': {
                    const secretKey = `${data.provider.toUpperCase()}_EMBED_API_KEY`;
                    await this.context.secrets.store(secretKey, data.key);
                    await this.refreshEmbedModels(data.provider);
                    break;
                }
                
                // Called after selecting an embedding model
                // Checks if a table for the model already exists and broadcast index status
                case 'loadVectorDB': {
                    // Clear the old indexer if we have one
                    if (this.indexer) this.indexer.dispose();

                    this.indexer = await Indexer.create(this.context, data.model, (provider: string) => this.getEmbedAPIKey(provider));
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
                    const apiKey = await this.getEmbedAPIKey(data.provider);
                    
                    const embedProvider = EmbedFactory.create(data.provider, apiKey);
                    
                    await this.indexer.indexWorkspace(embedProvider, data.model);
                    break;
                }

                // Take the changes from worktree and apply to main workspace
                case 'applyChanges': {
                    if (this.activeWorktree) {
                        try {
                            await this.activeWorktree.applyPatch();

                            this.chatHistory.push({ 
                                type: 'message', 
                                role: 'user', 
                                content: '[System: The user applied your proposed changes to the workspace.]',
                                turnID: this.activeTurn.turnID,
                                isHidden: true // Hidden message just for the agent
                            });
                            await this.saveChatHistory();
                            await this.clearActiveWorktree();
                            this.post({ type: 'updatePatchStatus', status: 'accepted' });

                        // Probably merge conflicts
                        } catch (e: any) {
                            if (e.message === 'MERGE_CONFLICT') {
                                await this.context.workspaceState.update('patchStatus', 'conflict');
                                this.post({ type: 'updatePatchStatus', status: 'conflict' });
                            } else {
                                vscode.window.showErrorMessage(`Failed to apply patch: ${e.message || String(e)}`);
                            }
                        }
                    }
                    break;
                }

                // Discard worktree
                case 'discardChanges': {
                    if (this.activeWorktree) {
                        await this.clearActiveWorktree();

                        this.chatHistory.push({ 
                            type: 'message', 
                            role: 'user', 
                            content: '[System: The user discarded your proposed changes. The workspace was reverted to its original state.]',
                            turnID: this.activeTurn.turnID,
                            isHidden: true
                        });
                        await this.saveChatHistory();
                        this.post({ type: 'updatePatchStatus', status: 'rejected' });
                    }
                    break;
                }

                // After resolving merge conflicts
                case 'markResolved': {
                    if (this.activeWorktree) {
                        await this.clearActiveWorktree();

                        this.chatHistory.push({ 
                            type: 'message', 
                            role: 'user', 
                            content: '[System: The user resolved merge conflicts and applied the changes.]', 
                            turnID: this.activeTurn.turnID, 
                            isHidden: true 
                        });
                        await this.saveChatHistory();
                        this.post({ type: 'updatePatchStatus', status: 'accepted' });
                    }
                    break;
                }
                
                // Forcing the patch by replacing the files in the main workspace
                case 'forceApplyPatch': {
                    if (this.activeWorktree) {
                        try {
                            await this.activeWorktree.forceApply();

                            await this.clearActiveWorktree();
                            this.chatHistory.push({ 
                                type: 'message', 
                                role: 'user', 
                                content: '[System: The user force-applied your changes, overwriting their local edits.]', 
                                turnID: this.activeTurn.turnID, 
                                isHidden: true 
                            });
                            await this.saveChatHistory();
                            this.post({ type: 'updatePatchStatus', status: 'accepted' });
                        } catch (e) {
                            vscode.window.showErrorMessage(`Failed to force apply: ${e}`);
                        }
                    }
                    break;
                }

                case 'openDiffView': {
                    if (this.activeWorktree) {
                        const workspaceRoot = vscode.workspace.workspaceFolders?.[0].uri.fsPath;
                        if (!workspaceRoot) return;

                        const originalUri = vscode.Uri.file(path.join(workspaceRoot, data.file));
                        const worktreeUri = vscode.Uri.file(path.join(this.activeWorktree.worktreePath, data.file));

                        const title = `${data.file} (Agent Proposal)`;
                        vscode.commands.executeCommand('vscode.diff', originalUri, worktreeUri, title);
                    }
                    break;
                }
            }
        });
    }

    private getHTML(): string {
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'src/webview', 'frontend.html');
        const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.bundle.js');
        const cssPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.bundle.css');

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

function formatError(e: unknown): string{
    if (e instanceof Error) {
        return e.stack ?? e.message;
    }

    return String(e);
}