import { inspectOllamaModel } from "../ollamaUtils";
import { OpenAICompatibleEmbedProvider } from "./openai";

export class ollamaEmbedProvider extends OpenAICompatibleEmbedProvider {
    private ollamaUrl: string;

    constructor(apiKey: string) {
        const url = `http://127.0.0.1:${apiKey}`;
        super('ollama', `${url}/v1`);
        this.ollamaUrl = url;
    }

    override async getModels(): Promise<string[]> {
        try {
            const response = await this.client.models.list();
            const allModelIds = response.data.map(m => m.id);

            const inspectedModels = await Promise.all(
                allModelIds.map(async (id) => ({
                    id,
                    meta: await inspectOllamaModel(this.ollamaUrl, id)
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