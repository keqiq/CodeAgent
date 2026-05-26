import * as vscode from 'vscode';
import * as fs from 'fs';
import { LLMFactory } from './apis/factory';

export class Sidebar implements vscode.WebviewViewProvider {

    private _view?: vscode.WebviewView;

    constructor(private readonly _extensionUri: vscode.Uri) {}

    public resolveWebviewView(webviewView: vscode.WebviewView, context: vscode.WebviewViewResolveContext, token: vscode.CancellationToken): Thenable<void> | void {
        this._view = webviewView;

        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this._extensionUri]
        };

        webviewView.webview.html = this._getHtml();


        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'askAgent': {
                    if (!data.value) { return; }
                    vscode.window.showInformationMessage(`Agent received: ${data.value}`);
                    break;
                }
                case 'fetchModels': {
                    try {
                        const envKey = `${data.provider.toUpperCase()}_API_KEY`;
                        const apiKey = process.env[envKey] || '';

                        if (!apiKey) {}

                        const providerInstance = LLMFactory.create(data.provider, apiKey);
                        const models = await providerInstance.getModels();

                        webviewView.webview.postMessage({ type: 'setModels', models: models});
                    } catch (e) {
                        vscode.window.showErrorMessage(`Failed to fetch models: ${e}`);
                        webviewView.webview.postMessage({ type: 'error' });
                    }
                }
                break;
            }
        })
    }

    private _getHtml(): string {
        const htmlPath = vscode.Uri.joinPath(this._extensionUri, 'media', 'sidebar.html');

        try {
            const html = fs.readFileSync(htmlPath.fsPath, 'utf-8');
            return html;
        } catch (e) {
            vscode.window.showErrorMessage(`Error loading sidebar html: ${e}`);
            return `<!DOCTYPE html><html><body>Error loading UI</body></html>`; 
        }
    }
}