import * as vscode from 'vscode';
import * as fs from 'fs';
import { MCPManager } from './managers/mcpManager';
import { parse } from 'shell-quote';

export class MCPViewProvider implements vscode.WebviewViewProvider {
    private view?: vscode.WebviewView;

    constructor(
        private readonly context: vscode.ExtensionContext,
        private readonly mcpManager: MCPManager
    ) {
        this.mcpManager.onDidUpdateStatus(event => this.post(event));
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

                    this.post({
                        type: 'restoreState',
                        states: this.mcpManager.getAllServerStates()
                    });

                    this.post({
                        type: 'updateHeaderStats',
                        ...this.mcpManager.getHeaderStats()
                    });

                    await this.mcpManager.restoreServerState();
                    break;
                }

                case 'addServer': {
                    try {
                        const config = data.config;

                        // Parse full command line string into command + args array
                        if (config.command) {
                            const tokens = parse(config.command).filter(
                                (token): token is string => typeof token === 'string'
                            );
                            if (tokens.length > 0) {
                                config.command = tokens[0];
                                config.args = tokens.slice(1);
                            }
                        }

                        await this.mcpManager.addServer(data.name, data.config);
                        if (data.autoConnect) {
                            await this.mcpManager.connect(data.name);
                        }
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
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Connection error: ${e.message || String(e)}`);
                    }
                    break;
                }

                case 'toggleTool': {
                    try {
                        await this.mcpManager.toggleTool(data.serverName, data.toolName, data.enabled);
                    } catch (e: any) {
                        vscode.window.showErrorMessage(`Error toggling tool: ${e.message || String(e)}`);
                    }
                    break;
                }

                case 'removeServer': {
                    await this.mcpManager.removeServer(data.name);
                    break;
                }
            }
        });
    }

    private post(message: any) { this.view?.webview.postMessage(message); }

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