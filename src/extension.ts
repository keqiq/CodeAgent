// The module 'vscode' contains the VS Code extensibility API
// Import the module and reference it with the alias vscode in your code below
import * as vscode from 'vscode';
import { allToolSchemas, toolRegistry } from './tools';
import { LLMFactory } from './apis/factory';
import { Sidebar } from './main';

declare const console: any;

// async function runAILoop(userPrompt: string) {
// 	vscode.window.withProgress({
// 		location: vscode.ProgressLocation.Notification,
// 		title: "Processing request...",
// 		cancellable: true
// 	}, async(progress, token) => {
// 		const messages: any[] = [
// 			{ role: "user", content: userPrompt}
// 		];

// 		let isDone = false;
// 		let turnCount = 0
// 		const MAX_TURNS = 15;

// 		const apiProvider = LLMFactory.create()

// 		while (!isDone && turnCount < MAX_TURNS) {
// 			if (token.isCancellationRequested) { vscode.window.showWarningMessage("Interrupted by user"); break; }

// 			turnCount++;
// 			progress.report({ message: `Thinking (Turn ${turnCount})...` })

// 			try {
// 				const llmResponse = await apiProvider.fetch(messages, allToolSchemas);

// 				messages.push({
// 					role: "assistant",
// 					tool_calls: llmResponse.tool_calls?.map(t => ({
// 						id: t.id,
// 						type: "function",
// 						function: {
// 							name: t.name,
// 							arguments: JSON.stringify(t.arguments)
// 						}
// 					}))
// 				});
				
// 				if (llmResponse.tool_calls) {
// 					for (const call of llmResponse.tool_calls) {
// 						progress.report({ message: `Running ${call.name}`});
						
// 						const toolFunction = toolRegistry[call.name];

// 						let toolResult = (toolFunction) ? await toolFunction(call.arguments) :
// 									`Error: Unknown tool ${call.name}`;

// 						messages.push({
// 							role: "tool",
// 							name: call.name,
// 							content: toolResult
// 						});
						 
// 					}
// 				} else if (llmResponse.text) {
// 					vscode.window.showInformationMessage(llmResponse.text);
// 					isDone = true;
// 				}
// 			} catch (e) {
// 				vscode.window.showErrorMessage(`Agent Error: ${e}`);
// 				isDone = true;
// 			}
// 		}
// 	});
// }

export function activate(context: vscode.ExtensionContext) {
	console.log('Plugin "CodeAgent" is active!');

	const sidebar = new Sidebar(context);

	context.subscriptions.push(
		vscode.window.registerWebviewViewProvider(
			"codeagent-sidebar",
			sidebar
		)
	);

	// const startAgentCommand = vscode.commands.registerCommand('CodeAgent.ask', async () => {
	// 	const prompt = await vscode.window.showInputBox({
	// 		prompt: "Enter prompt"
	// 	});

	// 	if (prompt) { await runAILoop(prompt) }
	// });

	// context.subscriptions.push(startAgentCommand);
}

export function deactivate() {}