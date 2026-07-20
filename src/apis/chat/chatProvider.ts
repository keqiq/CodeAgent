export type ChatItem =
    | { type: 'message'; role: 'developer' | 'user' | 'assistant'; content: string, turnID?: string, isHidden?: boolean }
    | { type: 'function_call'; id: string; name: string; arguments: any, turnID?: string}
    | { type: 'function_result'; id: string; name: string; result: string, turnID?: string }

export interface ChatResponse {
    items: ChatItem[];
    turnID?: string;
}

export interface StreamYield {
    type: 'text' | 'thought';
    content: string;
}

export interface ModelInfo {
    id: string;
    reason: boolean | undefined;
    efforts: string[];
    defaultEffort: string | null;
}

export abstract class ChatProvider {
    public static stateManagementSupport: boolean = true;
    abstract getModels(fetchAll?: boolean): Promise<ModelInfo[]>;
    // abstract fetch(model: string, history?: ChatItem[]): Promise<ChatResponse>;
    abstract fetchStream(
        model: string, 
        effort: string, 
        history?: ChatItem[], 
        previousTurnID?: string | undefined, 
        abortSignal?: AbortSignal
    ): AsyncGenerator<StreamYield, ChatResponse, unknown>;
}

