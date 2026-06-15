// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { Sidebar } from './main';

declare const console: any;

export function activate(context: vscode.ExtensionContext) {
	// console.log('Plugin "CodeAgent" is active!');

	const sidebar = new Sidebar(context);
	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"codeagent-sidebar",
			sidebar
		)
	);
	

}

export function deactivate() {}