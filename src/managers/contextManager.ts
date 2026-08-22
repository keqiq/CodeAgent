import * as vscode from 'vscode';
import { getEncoding, Tiktoken } from 'js-tiktoken';
import { ChatFactory } from '../apis/chat/chatFactory';
import { PRUNE_OUTPUT, PRUNE_INPUT } from '../tools/toolIndex';

export interface MessageItem {
    type: 'message';
    role: 'user' | 'assistant';
    content: string;
    thought?: string;
    turnID?: string;
    isHidden?: boolean;
}

export interface FunctionCallItem {
    type: 'function_call';
    id: string;
    name: string;
    arguments: any;
    turnID?: string;
    server?: boolean;
}

export interface FunctionResultItem {
    type: 'function_result';
    id: string;
    name: string;
    result: string;
    error: boolean;
    turnID?: string;
    data?: any;
}

export interface RunSummaryItem {
    type: 'run_summary';
    provider: string;
    model: string;
    status: 'ok' | 'aborted' | 'error';
    tokenUsage?: TokenUsage;
    message?: string;
    turnID?: string;
}

export interface CheckpointItem {
    type: 'checkpoint';
    summary: string;
    provider: string;
    model: string;
}

export type ChatItem = MessageItem | FunctionCallItem | FunctionResultItem | RunSummaryItem | CheckpointItem

export interface ChatResponse {
    items: ChatItem[];
    tokenUsage: TokenUsage | undefined;
    turnID?: string;
}

export interface TokenUsage {
    totalTokens: number | undefined,
    inputTokens: number | undefined,
    outputTokens: number | undefined,
    thoughtTokens: number | undefined
}

export interface TokenCategoryUsage {
    userTokens: number;
    assistantTokens: number;
    systemTokens: number;
    toolCallTokens: number;
    toolResultTokens: number;
    totalTokens: number;
}

interface ChatState {
    history: ChatItem[];
    summarizedHistory: ChatItem[];
    summarizeIndex: number;
}

export class ContextManager {
    private isInitialized: boolean = false;

    // Full history for frontend
    private history: ChatItem[] = [];

    private activeToolCalls: Map<string, FunctionCallItem> = new Map();
    private activeToolResults: FunctionResultItem[] = [];
    private turnsSinceLastPrune: number = 0;
    private runsSinceLastPrune: number = 0;

    private summarizedHistory: ChatItem[] = [];
    private summarizeIndex = 0;

    private currentProvider: string | undefined;
    private currentTurnID: string | undefined;
    private currentPrompt: MessageItem = { type: 'message', role: 'user', content: '' };
    private currentTurnToolResults: FunctionResultItem[] = [];

    // For roll back
    private previousTurnID: string | undefined;
    private previousProvider: string | undefined;

    private stateful: boolean = true;
    private pruneMode: string = 'run';
    private pruneTurnInterval: number = 2;
    private pruneRunInterval: number = 1;
    private readonly PRUNE_CHAR_THRESHOLD = 1_250;
    
    private runTokenUsage: TokenUsage = {
        totalTokens: 0,
        inputTokens: 0,
        outputTokens: 0,
        thoughtTokens: 0
    };
    private tokenEncoder: Tiktoken = getEncoding('o200k_base');

    private storageUri: vscode.Uri | undefined;
    private artifactsUri: vscode.Uri | undefined;

    private emitter = new vscode.EventEmitter();
    public readonly onDidUpdateStatus = this.emitter.event;

    constructor(private readonly context: vscode.ExtensionContext) {
        this.storageUri = context.storageUri;
        if (this.storageUri) this.artifactsUri = vscode.Uri.joinPath(this.storageUri, 'artifacts');
        this.currentProvider = this.context.globalState.get<string>('chatProvider');
    }

    public async initialize(): Promise<void> {
        if (!this.storageUri || this.isInitialized) return;
        try {
            await vscode.workspace.fs.createDirectory(this.storageUri);
            if (this.artifactsUri) await vscode.workspace.fs.createDirectory(this.artifactsUri);
        } catch (e) {
            console.error('Failed to create context directory');
        }

        await this.loadHistory();

        this.isInitialized = true;
    }

    public async loadHistory(): Promise<void> {
        if (!this.storageUri) return;

        const fileUri = vscode.Uri.joinPath(this.storageUri, 'chat_history.json');

        try {
            const data = await vscode.workspace.fs.readFile(fileUri);
            const state = JSON.parse(new TextDecoder().decode(data)) as ChatState;

            if (state.history) this.history = state.history;
            if (state.summarizedHistory) this.summarizedHistory = state.summarizedHistory;
            if (state.summarizeIndex) this.summarizeIndex = state.summarizeIndex;
        } catch (e) {
            console.log('No existing chat history found');
        }
    }

    public async save(): Promise<void> {
        if (!this.storageUri) return;

        const state: ChatState = {
            history: this.history,
            summarizedHistory: this.summarizedHistory,
            summarizeIndex: this.summarizeIndex
        };

        const fileUri = vscode.Uri.joinPath(this.storageUri, 'chat_history.json');
        const data = new TextEncoder().encode(JSON.stringify(state, null, 2));

        await vscode.workspace.fs.writeFile(fileUri, data);
    }

    public getHistory(): ChatItem[] {
        return [...this.history];
    }

    public getTurnID(): string | undefined {
        return this.currentTurnID;
    }

    public setTurnID(turnID: string | undefined): void {

        if (this.currentTurnID !== turnID) this.currentTurnToolResults = [];

        this.currentTurnID = turnID;
    }

    public prepareRun(provider: string): void {
        this.resetTokenUsage();

        this.stateful = this.context.globalState.get<boolean>('serverStateManagement') ?? true;
        this.pruneMode = this.context.globalState.get<string>('pruneMode') ?? 'run';
        this.pruneTurnInterval = this.context.globalState.get<number>('pruneTurnInterval') ?? 2;
        this.pruneRunInterval = this.context.globalState.get<number>('pruneRunInterval') ?? 1;

        this.changeProvider(provider);
    }

    public changeProvider(provider: string): void {
        // Save previous state
        this.previousTurnID = this.currentTurnID;
        this.previousProvider = this.currentProvider;

        // If the provider changed or stateful is disabled, reset turn id
        if (this.currentProvider !== provider || !this.stateful) this.currentTurnID = undefined;
        this.currentProvider = provider;
    }

    // Extract all function calls for the agent loop
    // Save all messages and function calls expect for server function calls
    public processResponseItems(items: ChatItem[]): FunctionCallItem[] {
        if (!items || items.length === 0) return [];

        const functionCalls: FunctionCallItem[] = [];

        for (const item of items) {

            if (item.type === 'function_call') {
                functionCalls.push(item);

                // DO NOT SAVE SERVER FUNCTION CALLS
                if (!item.server) this.addFunctionCall(item.id, item.name, item.arguments);
            }
            else if (item.type === 'message') this.addAssistantMessage(item.content);
        }

        return functionCalls;
    }

    public rollback(): void {
        this.currentTurnID = this.previousTurnID;
        this.currentProvider = this.previousProvider;
    }

    private resetTokenUsage(): void {
        this.runTokenUsage = {
            totalTokens: 0,
            inputTokens: 0,
            outputTokens: 0,
            thoughtTokens: 0
        };
    }

    public recordTokenUsage(usage: TokenUsage): void {
        if (this.currentProvider!.toLowerCase() === 'claude') {
            // Claude returns cumulative token usage across turns
            this.runTokenUsage = {
                totalTokens: usage.totalTokens || 0,
                inputTokens: usage.inputTokens || 0,
                outputTokens: usage.outputTokens || 0,
                thoughtTokens: usage.thoughtTokens || 0
            };
        } else {
            // Other providers return incremental per-turn usage that must be accumulated
            this.runTokenUsage.totalTokens! += (usage.totalTokens || 0);
            this.runTokenUsage.inputTokens! += (usage.inputTokens || 0);
            this.runTokenUsage.outputTokens! += (usage.outputTokens || 0);
            this.runTokenUsage.thoughtTokens! += (usage.thoughtTokens || 0);
        }
    }

    public updateTokenUsage(): void {
        this.emitter.fire({ type: 'updateTokenUsage', usage: this.runTokenUsage });
    }

    public addUserMessage(content: string): void {
        const userMessage: MessageItem = {
            type: 'message',
            role: 'user',
            content,
            ...(this.currentTurnID && { turnID: this.currentTurnID })
        };
        this.history.push(userMessage);
        this.currentPrompt = userMessage;
    }

    public addAssistantMessage(content: string, thought?: string): void {
        this.history.push({
            type: 'message',
            role: 'assistant',
            content,
            ...(thought && { thought }),
            ...(this.currentTurnID && { turnID: this.currentTurnID })
        });
    }

    public addSystemMessage(content: string): void {
        this.history.push({
            type: 'message',
            role: 'user',
            content: `[System: ${content}]`,
            ...(this.currentTurnID && { turnID: this.currentTurnID }),
            isHidden: true
        });
    }

    public addFunctionCall(id: string, name: string, args: any): void {
        const parsedArgs = typeof args === 'string' ? (() => { try { return JSON.parse(args); } catch { return args; } })() : args;

        const item: FunctionCallItem = {
            type: 'function_call',
            id,
            name,
            arguments: parsedArgs,
            ...(this.currentTurnID && { turnID: this.currentTurnID })
        };

        this.history.push(item);
        this.activeToolCalls.set(id, item);
    }

    public addFunctionResult(id: string, name: string, result: string, error: boolean, data?: any): void {
        const item: FunctionResultItem = {
            type: 'function_result',
            id,
            name,
            result,
            error,
            ...(this.currentTurnID && { turnID: this.currentTurnID }),
            ...(data && { data })
        };
        this.history.push(item);
        this.activeToolResults.push(item);
        this.currentTurnToolResults.push(item);
    }

    public addRunSummary(provider: string, model: string, status: 'ok' | 'aborted' | 'error', message?: string): void {
        this.history.push({
            type: 'run_summary',
            provider: provider,
            model: model,
            status,
            ...(message && { message }),
            ...(this.runTokenUsage && { tokenUsage: { ...this.runTokenUsage } }),
            ...(this.currentTurnID && { turnID: this.currentTurnID })
        });
    }

    public async clear(): Promise<void> {
        this.history = [];
        this.summarizedHistory = [];
        this.summarizeIndex = 0;
        this.currentPrompt = { type: 'message', role: 'user', content: '' };
        this.activeToolCalls.clear();
        this.activeToolResults = [];
        this.currentTurnToolResults = [];
        this.currentTurnID = undefined;
        this.previousTurnID = undefined;
        this.currentProvider = '';
        this.previousProvider = '';
        this.turnsSinceLastPrune = 0;
        this.runsSinceLastPrune = 0;
        this.resetTokenUsage();
        await this.save();
        await this.clearArtifacts();
    }

    public async updateTurnBoundary(previousTurnHadError: boolean): Promise<void> {
        this.turnsSinceLastPrune++;

        // If previous tool results contain errors, keep tool results for debug context
        if (previousTurnHadError) return;

        if (this.pruneMode === 'turn' && this.turnsSinceLastPrune >= this.pruneTurnInterval) {
            await this.pruneActiveTools();
        }
    }

    public async updateRunBoundary(): Promise<void> {
        this.runsSinceLastPrune++;

        if (this.pruneMode === 'run' && this.runsSinceLastPrune >= this.pruneRunInterval) {
            await this.pruneActiveTools();
        }
    }

    public async readArtifact(artifactID: string): Promise<string> {
        if (!this.artifactsUri) throw new Error('Artifact storage not initialized');

        const fileUri = vscode.Uri.joinPath(this.artifactsUri, artifactID);

        const data = await vscode.workspace.fs.readFile(fileUri);
        return new TextDecoder().decode(data);
    }

    public async saveArtifactContent(name: string, id: string, content: string): Promise<string> {
        if (!this.artifactsUri) return 'artifact_storage_disabled';

        const artifactID = `artifact_${name}_${id}_${Date.now()}.txt`;
        const fileUri = vscode.Uri.joinPath(this.artifactsUri, artifactID);

        const data = new TextEncoder().encode(content);
        await vscode.workspace.fs.writeFile(fileUri, data);

        return artifactID;
    }

    public async pruneActiveTools(): Promise<void> {
        if (this.activeToolResults.length === 0) {
            this.activeToolCalls.clear();
            return;
        }

        // I am assuming that providers assign unique ids to each tool!
        // Maybe i should make a separate field for this purpose
        for (const resultItem of this.activeToolResults) {
            const callItem = this.activeToolCalls.get(resultItem.id);
            const isRecall = resultItem.name === 'recall';

            // Check if result output needs pruning
            const shouldPruneOutput = 
                isRecall ||
                PRUNE_OUTPUT.has(resultItem.name) ||
                resultItem.result.length > this.PRUNE_CHAR_THRESHOLD ||
                resultItem.error;

            // Check if call input needs pruning
            const inputFields = PRUNE_INPUT[resultItem.name] || [];
            let shouldPruneInput = false;

            if (callItem && typeof callItem.arguments === 'object' && callItem.arguments !== null) {
                for (const field of inputFields) {
                    if (typeof callItem?.arguments[field] === 'string' && callItem.arguments[field].length > this.PRUNE_CHAR_THRESHOLD) {
                        shouldPruneInput = true;
                        break;
                    }
                }
            }

            // Do not prune if neither function call or function result meet pruning criteria
            if (!shouldPruneInput && !shouldPruneOutput) continue;

            let artifactID: string;

            // If pruning a recall tool, point back to original artifact
            if (isRecall) {
                artifactID = resultItem.data?.artifactID || 'unknown_artifact';

            // Save tool result and tool call parameters to artifact
            } else {
                let artifactText = `=== TOOL: ${resultItem.name} (Call ID: ${resultItem.id}) ===\n\n`;

                if (callItem) {
                    artifactText += `--- INPUT ARGUMENTS ---\n${JSON.stringify(callItem.arguments, null, 2)}\n\n`;
                }

                artifactText += `--- OUTPUT RESULT ---\n${resultItem.result}\n`;

                artifactID = await this.saveArtifactContent(resultItem.name, resultItem.id, artifactText);
            }

            // Prune input fields on the call item
            if (callItem && typeof callItem.arguments === 'object' && callItem.arguments !== null) {
                for (const field of inputFields) {
                    const val = callItem.arguments[field];
                    if (typeof val === 'string' && val.length > this.PRUNE_CHAR_THRESHOLD) {
                        callItem.arguments[field] = `[${field} pruned (${val.length} chars). Stored in artifact: ${artifactID}]`;
                    }
                }
            }

            // Prune output text on result item
            if (shouldPruneOutput) {
                if (resultItem.error) {
                    resultItem.result = `[Tool '${resultItem.name}' failed. Full output/error stored in artifact: ${artifactID}]`;
                } else {
                    resultItem.result = `[Tool '${resultItem.name}' executed successfully. Full output stored in artifact: ${artifactID}]`;
                }
            }
        }

        // Reset tracking
        this.activeToolCalls.clear();
        this.activeToolResults = [];
        this.turnsSinceLastPrune = 0;
        this.runsSinceLastPrune = 0;
    }

    private async clearArtifacts(): Promise<void> {
        if (!this.artifactsUri) return;

        try {
            await vscode.workspace.fs.delete(this.artifactsUri, { recursive: true, useTrash: false });
            await vscode.workspace.fs.createDirectory(this.artifactsUri);
        } catch (e) {
            console.error('Failed to clear artifacts directory:', e);
        }

    }

    public getLLMContext(fullContext: boolean = false): ChatItem[] {
        const supportsState = this.currentProvider ? ChatFactory.supportsStateManagement(this.currentProvider) : false;

        // For providers with serverside context management, send only newest tool result and user prompt
        if (!fullContext && this.stateful && supportsState && this.currentTurnID) {
            const delta: ChatItem[] = [];

            // Only include the cached user message if it belongs to the active turn
            if (this.currentPrompt && this.currentPrompt.turnID === this.currentTurnID) {
                delta.push(this.currentPrompt);
            }

            // Only include cached tool results that match the active turn
            for (const toolResult of this.currentTurnToolResults) {
                if (toolResult.turnID === this.currentTurnID) {
                    delta.push(toolResult);
                }
            }
            return delta;
        }
        // We return the summarized long term history (if it exists)
        // along with verbatim recent history
        return [
            ...this.summarizedHistory,
            ...this.history.slice(this.summarizeIndex)
        ];
    }

    // This is different from updateTokenUsage
    // This updates the pie chart in the context window menu, it is an estimate for the token usage for different categories of messages
    // Whereas updateTokenUsage is an accurate provider issued token usage counter for input and output tokens
    public estimateCategorizedTokens(): void {

        const usage: TokenCategoryUsage = {
            userTokens: 0,
            assistantTokens: 0,
            systemTokens: 0,
            toolCallTokens: 0,
            toolResultTokens: 0,
            totalTokens: 0
        };

        const baseOverhead = 4;

        usage.systemTokens += this.tokenEncoder.encode(ChatFactory.getSystemPrompt(this.currentProvider!)).length + baseOverhead;

        usage.systemTokens += this.tokenEncoder.encode(JSON.stringify(ChatFactory.getToolSchemas(this.currentProvider!))).length + baseOverhead;

        // Token usage for full context
        const currentContext = this.getLLMContext(true);
        for (const item of currentContext) {
            let textToEncode = "";

            switch (item.type) {
                case 'message':
                    textToEncode = item.content;
                    if (item.thought) textToEncode += item.thought;

                    const messageTokens = this.tokenEncoder.encode(textToEncode).length + baseOverhead;

                    if (item.role === 'user') usage.userTokens += messageTokens;
                    else if (item.role === 'assistant') usage.assistantTokens += messageTokens;
                    break;

                case 'function_call':
                    textToEncode = item.name + JSON.stringify(item.arguments);
                    usage.toolCallTokens += this.tokenEncoder.encode(textToEncode).length + baseOverhead;
                    break;

                case 'function_result':
                    textToEncode = item.name + item.result; 
                    usage.toolResultTokens += this.tokenEncoder.encode(textToEncode).length + baseOverhead;
                    break;

                case 'run_summary':
                    break;
            }
        }

        usage.totalTokens = usage.userTokens + usage.assistantTokens + usage.systemTokens + usage.toolCallTokens + usage.toolResultTokens;

        this.emitter.fire({ type: 'updateContextWindowUsage', usage: usage });
    }

    public async condenseContext(provider: string, model: string, key: string, abortSignal: AbortSignal, keepRecentCount: number = 2): Promise<void> {

        const targetIndex = keepRecentCount > 0 ?
            Math.max(this.summarizeIndex, this.history.length - keepRecentCount) :
            this.history.length;

        const itemsToSummarize: ChatItem[] = [
            ...this.summarizedHistory,
            ...this.history.slice(this.summarizeIndex, targetIndex)
        ];

        const providerInstance = ChatFactory.create(provider, key, 'none');

        const summaryText = await providerInstance.summarizeContext(
            model,
            itemsToSummarize,
            this.currentTurnID,
            abortSignal
        );

        if (abortSignal.aborted) throw new Error('Condensing aborted');

        // [ Active LLM Context ] fron getLLMContext
        // ├── 1. Summarized History (Structured summary + acknowledgement pair)
        // ├── 2. Verbatim Recent Turns (Pre-compaction buffer, e.g. last 1–2 turns)
        // └── 3. New Turns After Summary (Subsequent prompts, tool calls, and results)
        this.summarizedHistory = [
            {
                type: 'message',
                role: 'user',
                content: `[Previous Conversation Summary]\n${summaryText.trim()}\n\nPlease continue fulfilling the request using this context.`,
                isHidden: true
            },
            {
                type: 'message',
                role: 'assistant',
                content: 'Understood. I have incorporated the conversation summary and will continue with the active tasks.',
                isHidden: true
            }
        ];


        // Show the summary in the frontend,
        // This will restore it on reload, 
        // Checkpoints are filtered out before reaching the provider as it's already included in summarizedHistory
        this.history.push({
            type: 'checkpoint',
            summary: summaryText,
            provider: provider,
            model: model
        });

        this.summarizeIndex = targetIndex;

        this.currentTurnID = undefined;

        await this.save();

        this.emitter.fire({ type: 'createCheckpoint', summary: summaryText, provider: provider, model: model });
        this.estimateCategorizedTokens();

    }
}