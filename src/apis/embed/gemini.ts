import { GoogleGenAI } from "@google/genai";
import { EmbedProvider } from "./embedProvider";

export class GeminiEmbedProvider extends EmbedProvider {
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

    async embed(model: string, texts: string[]): Promise<number[][]> {
        const vectors: number[][] = [];
        for (const text of texts) {
            const result = await this.client.models.embedContent ({
                model: model,
                contents: text,
                // config: { outputDimensionality: this.dimensions }
            });
            const vector = result.embeddings?.[0]?.values;

            if (!vector) throw new Error("Gemini did not return embeddings");


            vectors.push(vector);
        }

        return vectors;
    }
}