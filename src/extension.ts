import * as vscode from 'vscode';

import { ChatApp } from './chat';
import { MCPViewProvider } from './mcp';
import { MCPManager } from './managers/mcpManager';

declare const console: any;

export async function activate(context: vscode.ExtensionContext) {

    if (context.storageUri) await vscode.workspace.fs.createDirectory(context.storageUri);

	const mcpManager = new MCPManager(context);

    const mcpProvider = new MCPViewProvider(context, mcpManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codeagent-mcp', mcpProvider)
    );

    const chatApp = new ChatApp(context, mcpManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider(
            'codeagent-sidebar', 
            chatApp,
            {   
                // Do not unload when hidden
                webviewOptions: {
                    retainContextWhenHidden: true
                }
            }
        )
    );
	
}

export function deactivate() {}