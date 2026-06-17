import * as vscode from 'vscode';
import { ChatApp } from './main';

declare const console: any;

export function activate(context: vscode.ExtensionContext) {

	const chatApp = new ChatApp(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"codeagent-sidebar",
			chatApp
		)
	);
}

export function deactivate() {}