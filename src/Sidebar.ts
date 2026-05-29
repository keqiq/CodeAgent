import * as vscode from 'vscode';
import * as fs from 'fs';
import { LLMFactory } from './apis/factory';
import { ChatMessage } from './apis/provider';

export class Sidebar implements vscode.WebviewViewProvider {

    private _view?: vscode.WebviewView;

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
                                webviewView.webview.postMessage({
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
                            webviewView.webview.postMessage({ type: 'requestApiKey', provider: data.provider });
                            return;
                        }
                        webviewView.webview.postMessage({ type: 'setModels',
                            models: await this.getModelsFromProvider(data.provider, apiKey) })
                            
                        } catch (e) {
                            vscode.window.showErrorMessage(`Failed to fetch models: ${e}`);
                            webviewView.webview.postMessage({ type: 'error' });
                        }
                        break;
                    }
                    case 'saveApiKey': {
                        try {
                            const secretKey = `${data.provider.toUpperCase()}_API_KEY`;
                            await this._context.secrets.store(secretKey, data.key);
                            
                            webviewView.webview.postMessage({ type: 'setModels',
                                models: await this.getModelsFromProvider(data.provider, data.key) })
                            } catch (e) {
                                vscode.window.showErrorMessage(`Invalid key or Failed to fetch models: ${e}`);
                                webviewView.webview.postMessage({ type: 'requestApiKey', provider: data.provider });
                            }
                            break;
                        }
                        
                        case 'saveModelPreference': {
                            await this._context.globalState.update('selectedModel', data.model);
                            break;
                        }
                        case 'askAgent': {
                            if (!data.value) { return; }

                            // Keep the API key stateless
                            const apiKey = await this.getAPIKey(data.provider);

                            // This shouldn't happen as the send functin is disabled without apiKey
                            if (!apiKey) {
                                vscode.window.showErrorMessage(`No API key for ${data.provider}`);
                                return;
                            }

                            try {
                                const providerInstance = LLMFactory.create(data.provider, apiKey);

                                const conversationHistory: ChatMessage[] = [
                                    { role: "user", content: data.value}
                                ];

                                const llmResponse = await providerInstance.fetch(data.model, conversationHistory, []);

                                if (llmResponse.text) {
                                    webviewView.webview.postMessage({ type: 'receiveMessage', text: llmResponse.text });
                                }

                            } catch (e) {
                                webviewView.webview.postMessage({
                                    type: 'receiveMessage', text: `Error: could not fetch response ${e}`
                                });
                            }
                            break;
                        }
                    }
                })
            }
            
            private _getHtml(): string {
                const htmlPath = vscode.Uri.joinPath(this._context.extensionUri, 'media', 'sidebar.html');
                
                try {
                    const html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
                    return html;
                } catch (e) {
                    vscode.window.showErrorMessage(`Error loading sidebar html: ${e}`);
                    return `<!DOCTYPE html><html><body>Error loading UI</body></html>`; 
        }
    }
}