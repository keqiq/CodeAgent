import * as vscode from 'vscode';
import * as fs from 'fs';
import { ChatFactory } from './apis/chat/chatFactory';
import { ChatMessage } from './apis/chat/chatProvider';
import { createToolRegistry, ToolResult } from './tools/toolIndex';
import { EmbedFactory } from './apis/embed/embedFactory';
import { Indexer } from './indexing/indexer';
import { getChatAPIKey as getChatAPIKey, getEmbedAPIKey as getEmbedAPIKey, getEmbeddingModelsFromProvider as getEmbedModelsFromProvider, getModelsFromProvider as getChatModelsFromProvider } from './utils/apiUtils';

declare const console: any;

export class ChatApp implements vscode.WebviewViewProvider {

    private _view?: vscode.WebviewView;
    private MAX_TURN_COUNT = 15;
    
    private chatHistory: ChatMessage[];
    private toolRegistry: any;
    
    private indexer? : Indexer;
    private indexLoadPromise: Promise<Indexer>;
    
    constructor(private readonly context: vscode.ExtensionContext) {
        const savedHistory = context.workspaceState.get<ChatMessage[]>('chatHistory');
        
        if (savedHistory && savedHistory.length > 0) this.chatHistory = savedHistory;
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
                
                
                const apiKey = await getEmbedAPIKey(this.context, providerId);
                if (!apiKey) throw new Error("missing embedding API key");
                const indexer = await this.indexLoadPromise;
                
                return {
                    indexer: indexer,
                    embedProvider: EmbedFactory.create(providerId, apiKey),
                 model
                };
            }
        });
    }

    private getInitialChatMessages(): ChatMessage[] {
        return [{
            role: 'system',
            content: `You are an autonomous, expert software engineering agent integrated into VS Code. 
                      You have access to tools that can search, read, write, and edit files in the user's workspace.
                      When a user asks you to find a bug or fix a problem, DO NOT ask them for the file name if you can search for it yourself. 
                      Proactively use your 'glob' and 'grep' tools to explore the workspace, find the relevant code, read it, and edit it to fix the issue. 
                      Always explain your thought process before executing a tool.`
        }];
    }

    private post(message: any) { this._view?.webview.postMessage(message); }

    private async saveChatHistory() { await this.context.workspaceState.update('chatHistory', this.chatHistory); }

    private async runAgentTurn(provider: string, model: string, userMessage: string,): Promise<void> {
        const apiKey = await getChatAPIKey(this.context, provider);
        const indexer = await this.indexLoadPromise;

        // This shouldn't happen as the send function is disabled without apiKey
        if (!apiKey) { vscode.window.showErrorMessage(`No API key for ${provider}`); return; }

        try {
            const providerInstance = ChatFactory.create(provider, apiKey);
            this.chatHistory.push({ role: 'user', content: userMessage });
            await this.saveChatHistory();

            let keepGoing = true;
            let turnCount = 0;

            let hasStartedToolGroup = false;
            let toolsRunThisTurn = 0;

            while (keepGoing && turnCount < this.MAX_TURN_COUNT) {
                turnCount++;

                const streamGenerator = providerInstance.fetchStream(model, this.chatHistory);
                let streamResult = await streamGenerator.next();
                
                while (!streamResult.done) {
                    if (streamResult.value) {
                        this.post({ type: 'streamChunk', chunk: streamResult.value });
                    }
                    streamResult = await streamGenerator.next();
                }
                
                this.post({ type: 'streamEnd' });
                const finalResponse = streamResult.value as { text?: string, tool_calls?: any[] };
                
                if (finalResponse && finalResponse.text) {
                    this.chatHistory.push({ role: 'assistant', content: finalResponse.text });
                }
                
                // // Text reply
                // const llmResponse = await providerInstance.fetch(model, this.chatHistory);
                // if (llmResponse.text) {
                //     this.chatHistory.push({ role: 'assistant', content: llmResponse.text });
                //     this.post({ type: 'streamStart'})
                //     this.post({ type: 'receiveMessage', text: llmResponse.text });
                // }

                // Tool calls
                // if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {
                if (finalResponse && finalResponse.tool_calls) {

                    if (!hasStartedToolGroup) {
                        hasStartedToolGroup = true;
                        this.post({ type: 'startToolGroup' });
                    }

                    this.chatHistory.push({
                        role: 'assistant',
                        content: JSON.stringify(finalResponse.tool_calls)
                    });

                    for (const toolCall of finalResponse.tool_calls) {
                        toolsRunThisTurn++;
                        const toolName = toolCall.name;
                        const toolArgs = toolCall.arguments;

                        this.post({
                            type: 'updateTool',
                            status: 'running',
                            toolName: toolName,
                            args: toolArgs
                        });

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

                        this.chatHistory.push({ role: 'system', content: `${toolName} result: ${result.message}` });
                    }

                } else {
                    keepGoing = false;
                }
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
                    this.post({
                        type: 'initProviders',
                        chatProviders: ChatFactory.getAvailableProviders(),
                        embedProviders: EmbedFactory.getAvailableProviders() 
                    });

                    const chatProvider = this.context.globalState.get<string>('chatProvider');
                    const chatModel = this.context.globalState.get<string>('chatModel');

                    this.post({ type: 'restoreChatHistory', history: this.chatHistory });

                    if (chatProvider) {
                        const apiKey = await getChatAPIKey(this.context, chatProvider);
                        if (apiKey) {
                            try {
                                const chatModels = await getChatModelsFromProvider(chatProvider, apiKey);
                                this.post({
                                    type: 'restoreChatState',
                                    provider: chatProvider,
                                    choice: chatModel, 
                                    models: chatModels
                                });
                            } catch (e) {

                            }
                        }
                    }

                    const indexEnabled = this.context.globalState.get<boolean>('indexEnabled') ?? false;
                    
                    if (indexEnabled) {
                        const embedProvider = this.context.globalState.get<string>('embedProvider');
                        const embedModel = this.context.globalState.get<string>('embedModel');
                        if (embedProvider) {
                            const indexer = await this.indexLoadPromise;
                            const embedApiKey = await getEmbedAPIKey(this.context, embedProvider);
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
                    
                    break;
                }

                case 'fetchChatModels': {
                    try {
                        await this.context.globalState.update('chatProvider', data.provider);

                        const apiKey = await getChatAPIKey(this.context, data.provider);

                        if (!apiKey) {
                            this.post({ type: 'requestChatAPIKey', provider: data.provider });
                            return;
                        }
                        this.post({
                            type: 'setChatModels',
                            models: await getChatModelsFromProvider(data.provider, apiKey)
                        });

                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to fetch models: ${e}`);
                    }
                    break;
                }

                case 'saveChatAPIKey': {
                    try {
                        const secretKey = `${data.provider.toUpperCase()}_CHAT_API_KEY`;
                        await this.context.secrets.store(secretKey, data.key);

                        this.post({
                            type: 'setChatModels',
                            models: await getChatModelsFromProvider(data.provider, data.key)
                        });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Invalid key or Failed to fetch models: ${e}`);
                        this.post({ type: 'requestChatAPIKey', provider: data.provider });
                    }
                    break;
                }

                case 'saveChatModel': {
                    await this.context.globalState.update('chatModel', data.model);
                    break;
                }

                case 'askAgent': {
                    if (!data.value) { return; }
                    this.runAgentTurn(data.provider, data.model, data.value);
                    break;
                }

                case 'clearChat': {
                    this.chatHistory = this.getInitialChatMessages();
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
                        const apiKey = await getEmbedAPIKey(this.context, data.provider);
                        if (!apiKey) {
                            this.post({ type: 'requestEmbedAPIKey', provider: data.provider });
                            return;
                        }

                        const models = await getEmbedModelsFromProvider(data.provider, apiKey);
                        this.post({ type: 'setEmbedModels', models });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to fetch embedding models: ${e}`);
                        this.post({ type: 'requestEmbedAPIKey', provider: data.provider });
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
                        const apiKey = await getEmbedAPIKey(this.context, data.provider);
                        if (!apiKey) {
                            this.post({ type: 'requestEmbedAPIKey', provider: data.provider });
                            return;
                        }
                        
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