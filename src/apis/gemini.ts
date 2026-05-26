import { GoogleGenAI } from '@google/genai';
import { LLMProvider, LLMResponse } from './provider';

export class GeminiProvider extends LLMProvider {
    private client: GoogleGenAI;

    constructor(apiKey: string) {
        super();
        this.client = new GoogleGenAI({ apiKey });
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

    async fetch(model: string, messages: any[], toolSchemas: any[]): Promise<LLMResponse> {

        const response = await this.client.models.generateContent({
            model: model,
            contents: messages,
            config: {
                tools: [{ functionDeclarations: toolSchemas}],
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