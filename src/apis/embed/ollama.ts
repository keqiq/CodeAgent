import { inspectOllamaModel } from "../ollamaUtils";
import { OpenAICompatibleEmbedProvider } from "./openai";

export class ollamaEmbedProvider extends OpenAICompatibleEmbedProvider {
    private static ollamaBaseUrl = 'http://127.0.0.1:11434';

    constructor(apiKey: string) {
        super(apiKey, `${ollamaEmbedProvider.ollamaBaseUrl}/v1`);
    }

    override async getModels(): Promise<string[]> {
        try {
            const response = await this.client.models.list();
            const allModelIds = response.data.map(m => m.id);

            const inspectedModels = await Promise.all(
                allModelIds.map(async (id) => ({
                    id,
                    meta: await inspectOllamaModel(ollamaEmbedProvider.ollamaBaseUrl, id)
                }))
            );

            // Prioritize dedicated embedding models
            const embeddingModels = inspectedModels
                .filter(({ meta }) => meta.isEmbedding)
                .map(({ id }) => id);

            // If the user has dedicated embedding models installed, only return those
            if (embeddingModels.length > 0) {
                return embeddingModels;
            }

            // If no dedicated embedding models exist, return all models as fallback
            return allModelIds;
        } catch (e) {
            console.error('Failed to fetch Ollama embed models.', e);
            return [];
        }
    }
}