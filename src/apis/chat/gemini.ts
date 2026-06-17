import { GoogleGenAI } from '@google/genai';
import { ChatMessage, ChatProvider, ChatResponse } from './chatProvider';
import { allToolSchemas } from '../../tools/toolIndex';

export class GeminiChatProvider extends ChatProvider {
    private client: GoogleGenAI;
    private geminiTools: any;

    constructor(apiKey: string) {
        super();
        this.client = new GoogleGenAI({ apiKey });
        this.geminiTools = this.parseTools();
    }

    async getModels(): Promise<string[]> {
        const response = await this.client.models.list();
        const modelNames: string[] = [];

        for await (const m of response) {
            if (m.supportedActions && m.supportedActions.includes('generateContent')) {
                if (m.name) {
                    const cleanName = m.name.replace('models/', '');
    
                    // if (cleanName.startsWith('gemini')) modelNames.push(cleanName);
                    modelNames.push(cleanName);
                }
            }
        }

        return modelNames.sort();
    }

    private parseTools() {
        const declarations = allToolSchemas.map(t => ({
            name: t.function.name,
            description: t.function.description,
            parameters: t.function.parameters
        }));

        return [{ functionDeclarations: declarations }];
    }

    private parseMessages(messages: ChatMessage[]) {
        return messages.map(msg => {
            return {
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content}]
            };
        });
    }

    async *fetchStream(model: string, history: ChatMessage[]): AsyncGenerator<string, ChatResponse, unknown> {
        const stream = await this.client.models.generateContentStream({
            model: model,
            contents: this.parseMessages(history),
            config: {
                tools: this.geminiTools,
                systemInstruction: "You are an expert AI coding assistant inside VS Code."
            }
        });

        
        let fullText = "";
        let toolCallsBuffer: any[] = [];
        
        for await (const chunk of stream) {
            if (chunk.functionCalls) {
                for (const call of chunk.functionCalls) {
                    toolCallsBuffer.push({
                        name: call.name || "",
                        arguments: call.args
                    });
                }

                return { text: null, tool_calls: toolCallsBuffer };
            }

            if (chunk.text) {
                fullText += chunk.text;
                yield chunk.text;
            }
        }

        return {
            text: fullText,
            tool_calls: null
        };
    }

    async fetch(model: string, messages: ChatMessage[]): Promise<ChatResponse> {

        const response = await this.client.models.generateContent({
            model: model,
            contents: this.parseMessages(messages),
            config: {
                tools: this.geminiTools,
                systemInstruction: "You are an expert AI coding assistant inside VS Code."
            }
        });

        const calls = response.functionCalls;

        if (calls && calls.length > 0) {
            const parsedCalls = [];

            for (const call of calls) {
                parsedCalls.push({
                    name: call.name || "",
                    arguments: call.args
                });
            }

            return {
                text: null,
                tool_calls: parsedCalls
            };
        }

        return { text: response.text || "", tool_calls: null};
    }
}