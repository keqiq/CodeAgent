import { ModelInfo }  from './chatProvider';
import { OpenAICompatibleProvider } from './openai';

export class KimiChatProvider extends OpenAICompatibleProvider {

    protected featuredModels = ['kimi-k3', 'kimi-k2.7-code', 'kimi-k2.6']; 

    constructor(apiKey: string) {
        super(apiKey, 'https://api.moonshot.ai/v1');
    }

    protected async getModelInfos(): Promise<ModelInfo[]> {
        const response = await this.client.models.list();
        const infos: ModelInfo[] = [];

        for (const m of response.data) {
            const id = m.id;

            // AFAIK k3 is the only model with reasoning effort
            // The other models can reason but ill set reason to false so the frontend wont see the effort dropdown
            // But it will still be on by default
            const reasonCapable = id === 'kimi-k3';

            infos.push({
                id: id,
                reason: reasonCapable,
                efforts: reasonCapable ? ['low', 'high', 'max'] : [],
                defaultEffort: reasonCapable ? 'max' : null // k3 defaults to max
            });
        }

        return infos;
    }
}