import OpenAI from 'openai';
import { EmbedProvider } from './embedProvider';

export class OpenAICompatibleEmbedProvider extends EmbedProvider {
    protected client: OpenAI;

    constructor(apiKey: string, baseURL?: string) {
        super();
        this.client = new OpenAI({ apiKey, baseURL });
    }

    async getModels(): Promise<string[]> {
        try {
            const response = await this.client.models.list();
            return response.data.map(m => m.id);
        } catch (e) {
            console.error('Failed to fetch embed models.', e);
            return [];
        }
    }

    async embed(model: string, texts: string[], abortSignal?: AbortSignal): Promise<number[][]> {
        const vectors: number[][] = [];
        for (const text of texts) {
            if (abortSignal?.aborted) throw new Error('AbortError');
            const result = await this.client.embeddings.create({
                model: model,
                input: text,
                encoding_format: 'float'
            }, { signal: abortSignal });

            const vector = result.data[0].embedding;

            vectors.push(vector);
        }

        return vectors;
    }
}

export class OpenAIEmbedProvider extends OpenAICompatibleEmbedProvider {

    constructor(apiKey: string) {
        super(apiKey);
    }

    async getModels(): Promise<string[]> {
        return [
            'text-embedding-3-small',
            'text-embedding-3-large',
            'text-embedding-ada-002'
        ];
    }


}