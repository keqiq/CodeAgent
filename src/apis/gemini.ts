import { GoogleGenAI } from '@google/genai';
import { ChatMessage, LLMProvider, LLMResponse } from './provider';
import { allToolSchemas } from '../tools';

export class GeminiProvider extends LLMProvider {
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
            if (m.name) {
                const cleanName = m.name.replace('models/', '');

                if (cleanName.startsWith('gemini')) modelNames.push(cleanName)
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

    async fetch(model: string, messages: ChatMessage[]): Promise<LLMResponse> {

        const geminiMessages = messages.map(msg => {
            return {
                role: msg.role === 'assistant' ? 'model' : 'user',
                parts: [{ text: msg.content}]
            };
        });

        const response = await this.client.models.generateContent({
            model: model,
            contents: geminiMessages,
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