import * as vscode from 'vscode';
import * as fs from 'fs';
import { ChatFactory } from './apis/chat/chatFactory';
import { ChatMessage } from './apis/chat/chatProvider';
import { createToolRegistry } from './tools/toolIndex';
import { EmbedFactory } from './apis/embed/embedFactory';
import { Indexer } from './indexing/indexer';

declare const console: any;

export class ChatApp implements vscode.WebviewViewProvider {

    private _view?: vscode.WebviewView;
    private MAX_TURN_COUNT = 15;
    private indexer? : Indexer;
    private indexLoadPromise: Promise<Indexer>;

    private chatHistory: ChatMessage[];
    private toolRegistry: any;

    constructor(private readonly context: vscode.ExtensionContext) {
        const savedHistory = context.workspaceState.get<ChatMessage[]>('agentChatHistory');

        if (savedHistory && savedHistory.length > 0) this.chatHistory = savedHistory;
        else this.chatHistory = this.getInitialChatMessages();
        
        this.indexLoadPromise = Indexer.create(this.context).then(indexer => {
            this.indexer = indexer;
            return indexer;
        });

        this.toolRegistry = createToolRegistry({
            createSearchCodebaseDeps: async () => {
                const providerId = this.context.globalState.get<string>('selectedEmbeddingProvider');
                const model = this.context.globalState.get<string>('selectedEmbeddingModel');

                if (!providerId || !model) throw new Error("embedding provider/model is not configured");
                

                const apiKey = await this.getEmbeddingAPIKey(providerId);
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


    private async getModelsFromProvider(provider: string, apiKey: string) {
        const providerInstance = ChatFactory.create(provider, apiKey);
        return await providerInstance.getModels();
    }

    private async getEmbeddingModelsFromProvider(provider: string, apiKey: string) {
        const providerInstance = EmbedFactory.create(provider, apiKey);
        return await providerInstance.getModels();
    }

    private async getAPIKey(provider: string) {
        const secretKey = `${provider.toUpperCase()}_API_KEY`;
        return await this.context.secrets.get(secretKey);
    }

    private async getEmbeddingAPIKey(provider: string) {
        const secretKey = `${provider.toUpperCase()}_EMBEDDING_API_KEY`;
        return await this.context.secrets.get(secretKey);
    }

    private post(message: any) { this._view?.webview.postMessage(message); }

    private async saveChatHistory() { await this.context.workspaceState.update('agentChatHistory', this.chatHistory); }

    private async runAgentTurn(provider: string, model: string, userMessage: string,): Promise<void> {
        const apiKey = await this.getAPIKey(provider);

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

                        let result = "";

                        if (this.toolRegistry[toolName]) {
                            try {
                                result = await this.toolRegistry[toolName](toolArgs);
                                this.post({ type: 'updateTool', status: 'success' });
                            } catch (e) {
                                result = `Error executing ${toolName}: ${e}`;
                                this.post({ type: 'updateTool', status: 'error', error: String(e) });
                            }
                        } else {
                            result = `Error: Tool '${toolName}' is not registered`;
                            this.post({ type: 'updateTool', status: 'error', error: "Invalid tool call" });
                        }

                        this.chatHistory.push({ role: 'system', content: `${toolName} result: ${result}` });
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
                    const savedProvider = this.context.globalState.get<string>('selectedProvider');
                    const savedModel = this.context.globalState.get<string>('selectedModel');

                    this.post({ type: 'restoreHistory', history: this.chatHistory });

                    if (savedProvider) {
                        const apiKey = await this.getAPIKey(savedProvider);
                        if (apiKey) {
                            try {
                                const models = await this.getModelsFromProvider(savedProvider, apiKey);
                                this.post({
                                    type: 'restoreState',
                                    provider: savedProvider,
                                    model: savedModel,
                                    models: models
                                });
                            } catch (e) {

                            }
                        }
                    }

                    const indexingEnabled = this.context.globalState.get<boolean>('indexingEnabled') ?? false;
                    const savedEmbeddingProvider = this.context.globalState.get<string>('selectedEmbeddingProvider');
                    const savedEmbeddingModel = this.context.globalState.get<string>('selectedEmbeddingModel');

                    if (savedEmbeddingProvider) {
                        const indexer = await this.indexLoadPromise;
                        const embedApiKey = await this.getEmbeddingAPIKey(savedEmbeddingProvider);
                        const hasIndex = indexer.dbConnected();

                        if (embedApiKey) {
                            try {
                                const models = await this.getEmbeddingModelsFromProvider(savedEmbeddingProvider, embedApiKey);
                                this.post({
                                    type: 'restoreIndexingState',
                                    enabled: indexingEnabled,
                                    provider: savedEmbeddingProvider,
                                    model: savedEmbeddingModel,
                                    models: models,
                                    status: hasIndex ? 'Ready' :
                                            indexingEnabled ? 'Not Indexed' : 'Disabled'
                                }); 
                            } catch (e) {}
                        }
                    }
                    
                    break;
                }
                case 'fetchModels': {
                    try {
                        await this.context.globalState.update('selectedProvider', data.provider);

                        const apiKey = await this.getAPIKey(data.provider);

                        if (!apiKey) {
                            this.post({ type: 'requestApiKey', provider: data.provider });
                            return;
                        }
                        this.post({
                            type: 'setModels',
                            models: await this.getModelsFromProvider(data.provider, apiKey)
                        });

                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to fetch models: ${e}`);
                        this.post({ type: 'error' });
                    }
                    break;
                }
                case 'saveApiKey': {
                    try {
                        const secretKey = `${data.provider.toUpperCase()}_API_KEY`;
                        await this.context.secrets.store(secretKey, data.key);

                        this.post({
                            type: 'setModels',
                            models: await this.getModelsFromProvider(data.provider, data.key)
                        });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Invalid key or Failed to fetch models: ${e}`);
                        this.post({ type: 'requestApiKey', provider: data.provider });
                    }
                    break;
                }

                case 'saveModelPreference': {
                    await this.context.globalState.update('selectedModel', data.model);
                    break;
                }
                case 'askAgent': {
                    if (!data.value) { return; }
                    this.runAgentTurn(data.provider, data.model, data.value);
                    break;
                }
                case 'clearChat': {
                    this.chatHistory = this.getInitialChatMessages();
                    await this.context.workspaceState.update('agentChatHistory', this.chatHistory);
                    break;
                }
                case 'setIndexingEnabled': {
                    await this.context.globalState.update('indexingEnabled', data.enabled);
                    break;
                }
                case 'fetchEmbeddingModels': {
                    try {
                        await this.context.globalState.update('selectedEmbeddingProvider', data.provider);
                        const apiKey = await this.getEmbeddingAPIKey(data.provider);
                        if (!apiKey) {
                            this.post({ type: 'requestEmbeddingApiKey', provider: data.provider });
                            return;
                        }

                        const models = await this.getEmbeddingModelsFromProvider(data.provider, apiKey);
                        this.post({ type: 'setEmbeddingModels', models });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to fetch embedding models: ${e}`);
                        this.post({ type: 'requestEmbeddingApiKey', provider: data.provider });
                    }
                    break;
                }
                case 'saveEmbeddingApiKey': {
                    try {
                        const secretKey = `${data.provider.toUpperCase()}_EMBEDDING_API_KEY`;
                        await this.context.secrets.store(secretKey, data.key);

                        const models = await this.getEmbeddingModelsFromProvider(data.provider, data.key);
                        this.post ({type: 'setEmbeddingModels', models });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Invalid embedding API key: ${e}`);
                        this.post({ type: 'requestEmbeddingApiKey', provider: data.provider });
                    }
                    break;
                }
                case 'saveEmbeddingModelPreference': {
                    await this.context.globalState.update('selectedEmbeddingModel', data.model);
                    break;
                }
                case 'indexWorkspace': {
                    try {
                        const apiKey = await this.getEmbeddingAPIKey(data.provider);
                        if (!apiKey) {
                            this.post({ type: 'requestEmbeddingApiKey', provider: data.provider });
                            return;
                        }
                        
                        if (!this.indexer) this.indexer = await Indexer.create(this.context);
                        const embedProvider = EmbedFactory.create(data.provider, apiKey);

                        await this.indexer.indexWorkspace(embedProvider, data.model);

                        this.post({
                            type: 'indexingStatus',
                            status: 'Indexed',
                            done: true,
                            hasIndex: true
                        });
                    } catch (e) {
                        vscode.window.showErrorMessage(`Indexing failed: ${formatError(e)}`);
                        this.post({ type: 'indexingError' });
                    }
                    break;
                }
            }
        });
    }

    private _getHtml(): string {
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.html');
        const cssPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css');
        try {
            let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
            const styleUri = this._view!.webview.asWebviewUri(cssPath);
            html = html.replace('{{styleUri}}', styleUri.toString());
            return html;
        } catch (e) {
            vscode.window.showErrorMessage(`Error loading sidebar html: ${e}`);
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