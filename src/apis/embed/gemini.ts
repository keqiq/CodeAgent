import { GoogleGenAI } from "@google/genai";
import { EmbedProvider } from "./embedProvider";

export class GeminiEmbedProvider extends EmbedProvider {
    providerId: string = 'Gemini';

    private client: GoogleGenAI;

    constructor(apiKey: string) {
        super();
        this.client = new GoogleGenAI({ apiKey });
    }

    async getModels(): Promise<string[]> {
        const response = await this.client.models.list();
        const modelNames: string[] = [];

        for await (const m of response) {
            if (m.supportedActions && m.supportedActions.includes('embedContent')) {
                if (m.name) {
                    const cleanName = m.name.replace('models/', '');
                    modelNames.push(cleanName);
                }
            } 
        }

        return modelNames.sort();

    }

    async embed(model: string, text: string[]): Promise<number[][]> {
        const result = await this.client.models.embedContent ({
            model: model,
            contents: text,
            // config: { outputDimensionality: this.dimensions }
        });

        if (!result.embeddings) throw new Error("Gemini did not return embeddings");

        return result.embeddings.map(embedding => {
            if (!embedding.values) {
                throw new Error("Gemini returned an embedding without values");
            }

            return embedding.values;
        });
    }
}