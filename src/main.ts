import * as vscode from 'vscode';
import * as fs from 'fs';
import { ChatFactory } from './apis/chat/chatFactory';
import { ChatItem, ChatResponse, ModelInfo } from './apis/chat/chatProvider';
import { createToolRegistry, ToolResult } from './tools/toolIndex';
import { EmbedFactory } from './apis/embed/embedFactory';
import { Indexer } from './indexing/indexer';
import { getEmbeddingModelsFromProvider as getEmbedModelsFromProvider, getModelsFromProvider as getChatModelsFromProvider } from './utils/apiUtils';

declare const console: any;

export class ChatApp implements vscode.WebviewViewProvider {

    private _view?: vscode.WebviewView;
    
    private chatHistory: ChatItem[];
    private toolRegistry: any;
    private chatModelInfo: Map<string, ModelInfo> = new Map();
    
    private indexer? : Indexer;
    private indexLoadPromise: Promise<Indexer>;

    private previousTurnID: string | undefined = undefined;
    
    constructor(private readonly context: vscode.ExtensionContext) {
        const savedHistory = context.workspaceState.get<ChatItem[]>('chatHistory');
        
        if (savedHistory && savedHistory.length > 0) {
            this.chatHistory = savedHistory;
            const lastItemWithId = [...savedHistory].reverse().find(item => item.turnID);
            if (lastItemWithId) this.previousTurnID = lastItemWithId.turnID;
        }
        else this.chatHistory = this.getInitialChatMessages();
        
        this.indexLoadPromise = Indexer.create(this.context).then(indexer => {
            this.indexer = indexer;
            indexer.onDidUpdateStatus(event => this.post(event));
            return indexer;
        });
        
        this.toolRegistry = createToolRegistry({
            createSearchCodebaseDeps: async () => {
                const providerId = this.context.globalState.get<string>('embedProvider');
                const model = this.context.globalState.get<string>('embedModel');
                
                if (!providerId || !model) throw new Error("embedding provider/model is not configured");
                
                
                const apiKey = await this.getEmbedAPIKey(providerId);

                const indexer = await this.indexLoadPromise;
                
                return {
                    indexer: indexer,
                    embedProvider: EmbedFactory.create(providerId, apiKey),
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

    private post(message: any) { this._view?.webview.postMessage(message); }

    private async saveChatHistory() { await this.context.workspaceState.update('chatHistory', this.chatHistory); }

    private async getChatAPIKey(provider: string): Promise<string> {
        const secretKey = `${provider.toUpperCase()}_CHAT_API_KEY`;
        const chatAPIKey = await this.context.secrets.get(secretKey);
        if (!chatAPIKey) {
            this.post({ type: 'requestChatAPIKey', provider: provider });
            throw new Error(`Missing ${provider} API key`);
        }
        return chatAPIKey;
    }

    private async getEmbedAPIKey(provider: string): Promise<string> {
        const secretKey = `${provider.toUpperCase()}_EMBED_API_KEY`;
        const embedAPIKey =  await this.context.secrets.get(secretKey);
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

    private async runAgentTurn(provider: string, model: string, effort: string, userMessage: string,): Promise<void> {
        const indexer = await this.indexLoadPromise;
        
        try {
            const apiKey = await this.getChatAPIKey(provider); 
            const serverStateManagment = this.context.globalState.get<boolean>('serverStateManagement') ?? true;
            
            const providerInstance = ChatFactory.create(provider, apiKey);
            this.chatHistory.push({ type: 'message', role: 'user', content: userMessage, turnID: this.previousTurnID });
            await this.saveChatHistory();
            
            let keepGoing = true;
            let turnCount = 0;
            const turnLimit = this.context.globalState.get<number>('turnLimit') ?? 0;
            
            let hasStartedToolGroup = false;
            let toolsRunThisTurn = 0;
            
            while (keepGoing && (turnLimit === 0 || turnCount < turnLimit)) {
                turnCount++;
                
                const turnID = serverStateManagment ? this.previousTurnID : undefined;
                const streamGenerator = providerInstance.fetchStream(model, effort, this.chatHistory, turnID);
                let streamResult = await streamGenerator.next();
                
                while (!streamResult.done) {
                    if (streamResult.value) {
                        const content = streamResult.value.content;
                        
                        if (streamResult.value.type === 'text') this.post({ type: 'streamChunk', chunk: content });
                        else if (streamResult.value.type === 'thought') this.post({ type: 'streamThought', chunk: content });
                    }
                    streamResult = await streamGenerator.next();
                }
                
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
                                if (result.changedFiles?.length) indexer.scheduleReindex(result.changedFiles);
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
                this.previousTurnID = currentTurnID;
            }

            if (hasStartedToolGroup) this.post({ type: 'endToolGroup', totalCount: toolsRunThisTurn });
            await this.saveChatHistory();

        } catch (e) {
            this.post({ type: 'receiveMessage', text: `❌ Error: ${e}` });
            this.post({ type: 'streamEnd' });
        }
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, ctx: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };

        webviewView.webview.html = this._getHtml();


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
                        
                        this.post({
                            type: 'initProviders',
                            chatProviders: ChatFactory.getAvailableProviders(),
                            embedProviders: EmbedFactory.getAvailableProviders() 
                        });

                        this.post({ type: 'restoreChatHistory', history: this.chatHistory });
                        
                        const chatProvider = this.context.globalState.get<string>('chatProvider');
                        if (chatProvider) {
                            const stateManagementSupport = ChatFactory.supportsStateManagement(chatProvider);
                            this.post({ type: 'updateChatProvider', provider: chatProvider, stateful: stateManagementSupport });
                        }

                        const indexEnabled = this.context.globalState.get<boolean>('indexEnabled') ?? false;
                        
                        if (indexEnabled) {
                            const embedProvider = this.context.globalState.get<string>('embedProvider');
                            const embedModel = this.context.globalState.get<string>('embedModel');
                            if (embedProvider) {
                                const indexer = await this.indexLoadPromise;
                                const embedApiKey = await this.getEmbedAPIKey(embedProvider);
                                const hasIndex = indexer.dbConnected();
                                
                                if (!embedApiKey) {
                                    // Case 1: Provider selected, but no API key found
                                    this.post({
                                        type: 'restoreIndexState',
                                        enabled: true,
                                        provider: embedProvider,
                                        needsAPIKey: true,
                                        status: 'API key required'
                                    });
                                } else {
                                    try {
                                        // Case 2: Key exists, verify it by fetching models
                                        const embedModels = await getEmbedModelsFromProvider(embedProvider, embedApiKey);
                                        this.post({
                                            type: 'restoreIndexState',
                                            enabled: true,
                                            provider: embedProvider,
                                            choice: embedModel,
                                            models: embedModels,
                                            status: hasIndex ? 'Ready' : 'Not Indexed'
                                        }); 
                                    } catch (e) {
                                        // Case 3: Key exists but is invalid/expired
                                        this.post({
                                            type: 'restoreIndexState',
                                            enabled: true,
                                            provider: embedProvider,
                                            needsAPIKey: true,
                                            status: 'Invalid API key'
                                        });
                                    }
                                }
                            } else {
                                // Case 4: Indexing is enabled, but no provider is selected yet
                                this.post({
                                    type: 'restoreIndexState',
                                    enabled: true,
                                    status: 'Select Provider'
                                });
                            }
                        } else {
                            // Case 5: Indexing is disabled
                            this.post({
                                type: 'restoreIndexState',
                                enabled: false,
                                status: 'Disabled'
                            });
                        }
                    
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to restore state ${e}`);
                    }
                    break;
                }

                // Called after selecting provider from dropdown
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
                    this.refreshChatModels(data.provider);

                    break;
                }

                // Called after updateChatProvider and having a valid API key
                // Respond with curated list of models from provider, or all chat models if fetchall is set 
                case 'fetchChatModels': {
                    this.refreshChatModels(data.provider);
                    break;
                }

                // Called when selecting model from dropdown
                case 'saveChatModel': {
                    await this.context.globalState.update(`${data.provider}_chatModel`, data.model);
                    this.post({ type: 'updateChatModel', model: data.model });
                    break;
                }

                // Called after updateChatModel, fetch model information
                case 'fetchChatModelInfo': {
                    const info = this.chatModelInfo.get(data.model);
                    const chatProvider = this.context.globalState.get<string>('chatProvider');
                    const savedEffort = this.context.globalState.get<string>(`${chatProvider}_${data.model}_Effort`);
                    if (info) {
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

                case 'clearChat': {
                    this.chatHistory = this.getInitialChatMessages();
                    this.previousTurnID = undefined;
                    await this.context.workspaceState.update('chatHistory', this.chatHistory);
                    break;
                }

                case 'setIndexEnabled': {
                    await this.context.globalState.update('indexEnabled', data.enabled);
                    break;
                }

                case 'fetchEmbedModels': {
                    try {
                        await this.context.globalState.update('embedProvider', data.provider);
                        const apiKey = await this.getEmbedAPIKey(data.provider);

                        const models = await getEmbedModelsFromProvider(data.provider, apiKey);
                        this.post({ type: 'setEmbedModels', models });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to fetch embedding models: ${e}`);
                    }
                    break;
                }

                case 'saveEmbedAPIKey': {
                    try {
                        const secretKey = `${data.provider.toUpperCase()}_EMBED_API_KEY`;
                        await this.context.secrets.store(secretKey, data.key);

                        const models = await getEmbedModelsFromProvider(data.provider, data.key);
                        this.post ({type: 'setEmbedModels', models });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Invalid embedding API key: ${e}`);
                        this.post({ type: 'requestEmbedAPIKey', provider: data.provider });
                    }
                    break;
                }

                case 'saveEmbedModel': {
                    await this.context.globalState.update('embedModel', data.model);
                    break;
                }

                case 'indexWorkspace': {
                    try {
                        const apiKey = await this.getEmbedAPIKey(data.provider);
                        
                        const indexer = await this.indexLoadPromise;
                        const embedProvider = EmbedFactory.create(data.provider, apiKey);

                        const success = await indexer.indexWorkspace(embedProvider, data.model);

                        if (success) {
                            this.post({
                                    type: 'updateIndexStatus',
                                    status: 'Indexed',
                                    done: true,
                                    error: false,
                                    hasIndex: true
                                });
                        } else {
                            this.post({
                                type: 'updateIndexStatus',
                                status: 'No supported files found',
                                done: true,
                                error: false,
                                hasIndex: false
                            });
                            vscode.window.showInformationMessage("No supported files found to index.");
                        }
                    } catch (e) {
                        vscode.window.showErrorMessage(`Indexing failed: ${formatError(e)}`);
                        this.post({ 
                            type: 'updateIndexStatus',
                            status: 'Error',
                            done: false,
                            error: true,
                            hasIndex: false
                        });
                    }
                    break;
                }
            }
        });
    }

    private _getHtml(): string {
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'frontend.html');
        const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.bundle.js');
        const cssPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'webview.bundle.css');

        try {
            let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
            
            const scriptUri = this._view!.webview.asWebviewUri(scriptPath);
            const styleUri = this._view!.webview.asWebviewUri(cssPath);

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