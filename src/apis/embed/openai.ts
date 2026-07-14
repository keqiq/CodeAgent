import OpenAI from 'openai';
import { EmbedProvider } from './embedProvider';

export class OpenAIEmbedProvider extends EmbedProvider {
    providerId: string = 'OpenAI';

    private client: OpenAI;

    constructor(apiKey: string) {
        super();
        this.client = new OpenAI({ apiKey });
    }

    async getModels(): Promise<string[]> {
        return [
            'text-embedding-3-small',
            'text-embedding-3-large',
            'text-embedding-ada-002'
        ];
    }

    async embed(model: string, texts: string[]): Promise<number[][]> {
        const vectors: number[][] = [];
        for (const text of texts) {
            const result = await this.client.embeddings.create({
                model: model,
                input: text,
                encoding_format: 'float'
            });

            const vector = result.data[0].embedding;

            vectors.push(vector);
        }

        return vectors;
    }
}