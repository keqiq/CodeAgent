import { ChatItem, ChatResponse, TokenUsage } from "../../managers/contextManager";
import { requiredSchemas, ToolResult } from "../../tools/toolIndex";

export interface StreamYield {
    type: 'text' | 'thought' | 'server_action' | 'tool';
    content: string;
    actionId?: string;
    actionName?: string;
    actionQuery?: string;
}

export interface ModelInfo {
    id: string;
    reason: boolean | undefined;
    efforts: string[];
    defaultEffort: string | null;
    contextWindow?: number;
}

export type WebSearchMode = 'none' | 'tavily' | 'server';

export abstract class ChatProvider {

    public static systemPrompt: string = `You are an autonomous, expert software engineering agent integrated into VS Code. 
                      You have access to tools that can search, read, write, and edit files in the user's workspace.
                      When a user asks you to find a bug or fix a problem, DO NOT ask them for the file name if you can search for it yourself. 
                      Proactively use your semantic search tool 'find' tool to search the workspace.
                      Tools like 'glob' and 'grep' should be used as a fallback if semantic search fails to return relevant results.
                      Find the relevant code, read it, and edit it to add features and fix issues.`;

    public static stateManagementSupport: boolean = false;
    public static serverWebSearchSupport: boolean = false;
    public static baseTools: any[] = [...requiredSchemas];

    protected abstract featuredModels: string[];

    protected tools: any[] = [];

    protected abstract getModelInfos(): Promise<ModelInfo[]>;

    public getTools(): any[] {
        return this.tools;
    };

    private static modelCache: Map<Function, ModelInfo[]> = new Map();

    public async getModels(fetchAll?: boolean): Promise<ModelInfo[]> {
        const providerKey = this.constructor;

        if (!ChatProvider.modelCache.has(providerKey)) {
            ChatProvider.modelCache.set(providerKey, await this.getModelInfos());
        }

        const cachedModels = ChatProvider.modelCache.get(providerKey)!;

        if (fetchAll || this.featuredModels.length === 0) return cachedModels;

        return cachedModels.filter(info => this.featuredModels.includes(info.id));
    }

    abstract fetchStream(
        model: string, 
        effort: string, 
        history: ChatItem[], 
        previousTurnID: string | undefined,
        useCache: boolean,
        abortSignal: AbortSignal
    ): AsyncGenerator<StreamYield, ChatResponse, unknown>;

    abstract abortStream(): Promise<void>;

    protected static formatResponse(
        text: string, 
        toolCalls: Map<any, any>, 
        tokenUsage: TokenUsage, 
        turnID?: string,
        reasoning_content?: string
    ): ChatResponse {
        const items: ChatItem[] = [];

        items.push({
             type: 'message', 
             role: 'assistant', 
             content: text,
             ...(reasoning_content && { reasoning_content: reasoning_content } )
            });

        for (const call of Array.from(toolCalls.values())) {

            let parsedArgs: any = { args: 'None' };
            if (call.arguments) {
                if (typeof call.arguments === 'object') {
                    parsedArgs = call.arguments;
                } else {
                    try {
                        parsedArgs = JSON.parse(call.arguments);
                    } catch (e) {
                        parsedArgs = { query: call.arguments };
                    }
                }
            }
            items.push({ 
                type: 'function_call', 
                id: call.id, 
                name: call.name, 
                arguments: parsedArgs,
                turnID: call.turnID,
                server: call.server,
            });
        }

        return { items, tokenUsage, ...(turnID && {turnID}) };
    }
}