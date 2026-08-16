import * as vscode from 'vscode';
import * as fs from 'fs';
import { MCPManager } from './managers/mcpManager';

export class MCPViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly mcpManager: MCPManager
    ) {
        this.mcpManager.onDidUpdateStatus(async () => {
            await this.broadcastState();
        });
    }

    public async resolveWebviewView(
        webviewView: vscode.WebviewView, 
        context: vscode.WebviewViewResolveContext, 
        token: vscode.CancellationToken
    ): Promise<void> {
        this.view = webviewView;
        webviewView.webview.options = {
            enableScripts: true,
            localResourceRoots: [this.context.extensionUri]
        };
        webviewView.webview.html = this.getHTML();

        webviewView.webview.onDidReceiveMessage(async (data) => {
            switch (data.type) {
                case 'mcpViewReady': {
                    await this.broadcastState();
                    break;
                }

                case 'addServer': {
                    try {
                        await this.mcpManager.addServer(data.name, data.config);
                        if (data.autoConnect) {
                            await this.mcpManager.connect(data.name);
                        }
                        await this.broadcastState();
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Failed to add MCP server: ${e.message || String(e)}`);
                    }
                    break;
                }

                case 'toggleConnect': {
                    try {
                        if (data.connect) {
                            await this.mcpManager.connect(data.name);
                        } else {
                            await this.mcpManager.disconnect(data.name);
                        }
                        await this.broadcastState();
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Connection error: ${e.message || String(e)}`);
                    }
                    break;
                }

                case 'toggleTool': {
                    try {
                        await this.mcpManager.toggleTool(data.serverName, data.toolName, data.enabled);
                        await this.broadcastState();
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Error toggling tool: ${e.message || String(e)}`);
                    }
                    break;
                }

                case 'removeServer': {
                    await this.mcpManager.removeServer(data.name);
                    await this.broadcastState();
                    break;
                }
            }
        });
    }

    private async broadcastState(): Promise<void> {
        if (!this.view) return;
        const states = await this.mcpManager.getServerStates();
        this.view.webview.postMessage({
            type: 'syncState',
            servers: states
        });
    }

    private getHTML(): string {
        const htmlPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mcp.html');
        const scriptPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mcp.bundle.js');
        const cssPath = vscode.Uri.joinPath(this.context.extensionUri, 'dist', 'mcp.bundle.css');

        try {
            let html = fs.readFileSync(htmlPath.fsPath, 'utf-8');

            const scriptUri = this.view!.webview.asWebviewUri(scriptPath);
            const styleUri = this.view!.webview.asWebviewUri(cssPath);

            html = html.replace('{{styleUri}}', styleUri.toString());
            html = html.replace('{{scriptUri}}', scriptUri.toString());

            return html;
        } catch (e) {
            vscode.window.showErrorMessage(`Error loading MCP HTML: ${e}`);
            return `<!DOCTYPE html><html><body>Error loading UI</body></html>`;
        }
    }
}