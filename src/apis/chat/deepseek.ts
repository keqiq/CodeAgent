import { ModelInfo, WebSearchMode } from './chatProvider';
import { OpenAICompatibleProvider } from './openai';

export class DeepSeekChatProvider extends OpenAICompatibleProvider {
    protected featuredModels = ['deepseek-v4-flash', 'deepseek-v4-pro'];
    public static summaryModel: string = 'deepseek-v4-flash';
    
    constructor(apiKey: string, webSearchMode: WebSearchMode) {
        super(apiKey, 'https://api.deepseek.com', webSearchMode);
    }

    protected async getModelInfos(): Promise<ModelInfo[]> {
        const response = await this.client.models.list();
        const infos: ModelInfo[] = [];

        // DeepSeek only offers v4 models from their api docs and they have the same settings
        for (const m of response.data) {
            const id = m.id;
            infos.push({
                id: id,
                reason: true,
                efforts: ['high', 'xhigh'],
                defaultEffort: 'high',
                contextWindow: 1_000_000
            });
        }
        return infos;
    }
}