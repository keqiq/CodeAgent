import * as vscode from 'vscode';
import * as fs from 'fs';
import { LLMFactory } from './apis/factory';
import { ChatMessage } from './apis/provider';
import { toolRegistry } from './tools';
import { VectorDB } from './vector/vectorDB';

export class Sidebar implements vscode.WebviewViewProvider {

    private _view?: vscode.WebviewView;
    private vectorDB?: VectorDB;
    private MAX_TURN_COUNT = 15;

    private chatHistory: ChatMessage[] 

    constructor(private readonly context: vscode.ExtensionContext) {
        const savedHistory = context.workspaceState.get<ChatMessage[]>('agentChatHistory');

        if (savedHistory && savedHistory.length > 0) this.chatHistory = savedHistory
        else this.chatHistory = this.getInitialChatMessages()

        this.initVectorDB();
    }

    private async initVectorDB() {
        if (!this.context.storageUri) {
            vscode.window.showWarningMessage("No active workspace. Limited Functionality");
            return;
        }

        try {
            this.vectorDB = await VectorDB.create(this.context);
        } catch (e) {
            vscode.window.showErrorMessage(`Failed to initialize code search index: ${e}`);
        }
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
        const providerInstance = LLMFactory.create(provider, apiKey);
        const models = await providerInstance.getModels();
        return models
    }

    private async getAPIKey(provider: string) {
        const secretKey = `${provider.toUpperCase()}_API_KEY`;
        return await this.context.secrets.get(secretKey);
    }

    private post(message: any) { this._view?.webview.postMessage(message); }

    private async saveChatHistory() { await this.context.workspaceState.update('agentChatHistory', this.chatHistory); }

    private async runAgentTurn(provider: string, model: string, userMessage: string,): Promise<void> {
        const apiKey = await this.getAPIKey(provider);

        // This shouldn't happen as the send functin is disabled without apiKey
        if (!apiKey) { vscode.window.showErrorMessage(`No API key for ${provider}`); return;}

        try {
            const providerInstance = LLMFactory.create(provider, apiKey);
            this.chatHistory.push({ role: 'user', content: userMessage });
            await this.saveChatHistory();

            let keepGoing = true;
            let turnCount = 0;

            let hasStartedToolGroup = false;
            let toolsRunThisTurn = 0;

            while (keepGoing && turnCount < this.MAX_TURN_COUNT) {
                turnCount++;

                // const llmResponse = await providerInstance.fetch(model, this.chatHistory);
                const streamGenerator = providerInstance.fetchStream(model, this.chatHistory);
                let streamResult = await streamGenerator.next();

                while (!streamResult.done) {
                    if (streamResult.value) {
                        this.post({ type: 'streamChunk', chunk: streamResult.value });
                    }
                    streamResult = await streamGenerator.next();
                }

                this.post({ type: 'streamEnd' });
                const finalResponse = streamResult.value as { text? : string, tool_calls?: any[] };

                if (finalResponse && finalResponse.text) {
                    this.chatHistory.push({ role: 'assistant', content:finalResponse.text });
                }



                // // Text reply
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

                        if (toolRegistry[toolName]) {
                            try {
                                result = await toolRegistry[toolName](toolArgs);
                                this.post({ type: 'updateTool', status: 'success' });
                            } catch (e) {
                                result = `Error executing ${toolName}: ${e}`;
                                this.post({ type: 'updateTool', status: 'error', error: String(e) })
                            }
                        } else {
                            result = `Error: Tool '${toolName}' is not registered`;
                            this.post({ type: 'updateTool', status: 'error', error: "Invalid tool call" });
                        }

                        this.chatHistory.push({ role: 'system', content: `${toolName} result: ${result}` })
                    }

                } else {
                    keepGoing = false;
                }
            }

            if (hasStartedToolGroup) this.post({ type: 'endToolGroup', totalCount: toolsRunThisTurn});
            await this.saveChatHistory();

        } catch (e) {
            this.post({ type: 'receiveMessage', text: `❌ Error: ${e}`})
            this.post({ type: 'streamEnd' });
        }
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
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
                        const apiKey = await this.getAPIKey(savedProvider)
                        if (apiKey) {
                            try {
                                const providerInstance = LLMFactory.create(savedProvider, apiKey);
                                const models = await providerInstance.getModels();
                                this.post({
                                    type: 'restoreState',
                                    provider: savedProvider,
                                    model: savedModel,
                                    models: models
                                })
                            } catch (e) {

                            }
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
                        this.post({ type: 'setModels',
                            models: await this.getModelsFromProvider(data.provider, apiKey) })
                            
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
                        
                        this.post({ type: 'setModels',
                            models: await this.getModelsFromProvider(data.provider, data.key) })
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
                    this.runAgentTurn(data.provider, data.model, data.value)
                    break;
                }
                case 'clearChat': {
                    this.chatHistory = this.getInitialChatMessages();
                    await this.context.workspaceState.update('agentChatHistory', this.chatHistory);
                    break;
                }
            }
        });
    }
            
    private _getHtml(): string {
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.html');
        const cssPath  = vscode.Uri.joinPath(this.context.extensionUri, 'media', 'sidebar.css')        
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