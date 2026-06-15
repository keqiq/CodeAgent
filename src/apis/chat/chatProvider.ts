export interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
}

export interface ChatResponse {
    text: string | null;
    tool_calls: {
        id?: string;
        name: string;
        arguments: any;
    }[] | null;
}

export abstract class ChatProvider {
    abstract getModels(): Promise<string[]>;
    abstract fetch(model: string, messages: ChatMessage[]): Promise<ChatResponse>;
    abstract fetchStream(model: string, history: ChatMessage[]): AsyncGenerator<string, ChatResponse, unknown>;
}

