export type ChatItem =
    | { type: 'message'; role: 'developer' | 'user' | 'assistant'; content: string, turnID?: string }
    | { type: 'function_call'; id: string; name: string; arguments: any, turnID?: string}
    | { type: 'function_result'; id: string; name: string; result: string, turnID?: string }

export interface ChatResponse {
    items: ChatItem[];
    turnID?: string;
}

export abstract class ChatProvider {
    abstract getModels(): Promise<string[]>;
    // abstract fetch(model: string, history?: ChatItem[]): Promise<ChatResponse>;
    abstract fetchStream(model: string, history?: ChatItem[], previousTurnID?: string | undefined): AsyncGenerator<string, ChatResponse, unknown>;
}

