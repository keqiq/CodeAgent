import * as vscode from 'vscode';
import * as fs from 'fs';
import { LLMFactory } from './apis/factory';
import { ChatMessage } from './apis/provider';
import { toolRegistry } from './tools';

export class Sidebar implements vscode.WebviewViewProvider {

    private _view?: vscode.WebviewView;
    private MAX_TURN_COUNT = 15;

    private chatHistory: ChatMessage[] = [
        { 
            role: 'system', 
            content: `You are an autonomous, expert software engineering agent integrated into VS Code. 
                      You have access to tools that can search, read, write, and edit files in the user's workspace.
                      When a user asks you to find a bug or fix a problem, DO NOT ask them for the file name if you can search for it yourself. 
                      Proactively use your 'glob' and 'grep' tools to explore the workspace, find the relevant code, read it, and edit it to fix the issue. 
                      Always explain your thought process before executing a tool.`
        }
    ];


    constructor(private readonly _context: vscode.ExtensionContext) {}

    private async getModelsFromProvider(provider: string, apiKey: string) {
        const providerInstance = LLMFactory.create(provider, apiKey);
        const models = await providerInstance.getModels();
        return models
    }

    private async getAPIKey(provider: string) {
        const secretKey = `${provider.toUpperCase()}_API_KEY`;
        return await this._context.secrets.get(secretKey);
    }

    private post(message: any) { this._view?.webview.postMessage(message); }

    private async runAgentTurn(provider: string, model: string, userMessage: string,): Promise<void> {
        const apiKey = await this.getAPIKey(provider);

        // This shouldn't happen as the send functin is disabled without apiKey
        if (!apiKey) { vscode.window.showErrorMessage(`No API key for ${provider}`); return;}

        try {
            const providerInstance = LLMFactory.create(provider, apiKey);
            this.chatHistory.push({ role: 'user', content: userMessage });

            let keepGoing = true;
            let turnCount = 0;

            let hasStartedToolGroup = false;
            let toolsRunThisTurn = 0;

            while (keepGoing && turnCount < this.MAX_TURN_COUNT) {
                turnCount++;

                const llmResponse = await providerInstance.fetch(model, this.chatHistory);
                
                // Text reply
                if (llmResponse.text) {
                    this.chatHistory.push({ role: 'assistant', content: llmResponse.text });
                    this.post({ type: 'receiveMessage', text: llmResponse.text });
                }

                // Tool calls
                if (llmResponse.tool_calls && llmResponse.tool_calls.length > 0) {

                    if (!hasStartedToolGroup) {
                        hasStartedToolGroup = true;
                        this.post({ type: 'startToolGroup' });
                    }

                    this.chatHistory.push({
                        role: 'assistant',
                        content: JSON.stringify(llmResponse.tool_calls)
                    });

                    for (const toolCall of llmResponse.tool_calls) {
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
            this.post({ type: 'endToolGroup', totalCount: toolsRunThisTurn});

        } catch (e) {
            this.post({ type: 'receiveMessage', text: `❌ Error: ${e}`})
        }
    }

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._context.extensionUri]
        };

        webviewView.webview.html = this._getHtml();


        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {

                case 'webviewReady': {
                    const savedProvider = this._context.globalState.get<string>('selectedProvider');
                    const savedModel = this._context.globalState.get<string>('selectedModel');

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
                        await this._context.globalState.update('selectedProvider', data.provider);
                        
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
                        await this._context.secrets.store(secretKey, data.key);
                        
                        this.post({ type: 'setModels',
                            models: await this.getModelsFromProvider(data.provider, data.key) })
                        } catch (e) {
                            vscode.window.showErrorMessage(`Invalid key or Failed to fetch models: ${e}`);
                            this.post({ type: 'requestApiKey', provider: data.provider });
                        }
                        break;
                    }
                        
                case 'saveModelPreference': {
                    await this._context.globalState.update('selectedModel', data.model);
                    break;
                }
                case 'askAgent': {
                    if (!data.value) { return; }
                    this.runAgentTurn(data.provider, data.model, data.value)
                    break;
                }
            }
        });
    }
            
    private _getHtml(): string {
        const htmlPath = vscode.Uri.joinPath(this._context.extensionUri, 'media', 'sidebar.html');
        const cssPath  = vscode.Uri.joinPath(this._context.extensionUri, 'media', 'sidebar.css')        
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