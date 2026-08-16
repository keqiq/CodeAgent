import * as vscode from 'vscode';

import { ChatApp } from './chat';
import { MCPViewProvider } from './mcp';
import { MCPManager } from './managers/mcpManager';

declare const console: any;

export function activate(context: vscode.ExtensionContext) {
	const mcpManager = new MCPManager(context);

    const mcpProvider = new MCPViewProvider(context, mcpManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codeagent-mcp', mcpProvider)
    );

    const chatApp = new ChatApp(context, mcpManager);
    context.subscriptions.push(
        vscode.window.registerWebviewViewProvider('codeagent-sidebar', chatApp)
    );
	
}

export function deactivate() {}