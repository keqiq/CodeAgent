
export interface LLMResponse {
    text: string | null;
    tool_calls: {
        id?: string;
        name: string;
        arguments: any;
    }[] | null;
}

export abstract class LLMProvider {
    abstract getModels(): Promise<string[]>;
    abstract fetch(model: string, messages: any[], toolSchemas: any[]): Promise<LLMResponse>;
}

