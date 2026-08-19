export interface OllamaModelMeta {
    isEmbedding: boolean;
    isTextGeneration: boolean;
    contextWindow?: number;
    family?: string;
}

const EMBEDDING_ARCHITECTURES = new Set([
    'bert',
    'nomic-bert',
    'xlm-roberta',
    'bge',
    'clip',
    't5-encoder'
]);

export async function inspectOllamaModel(
    baseUrl: string,
    modelId: string
): Promise<OllamaModelMeta> {
    try {
        const res = await fetch(`${baseUrl}/api/show`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name: modelId })
        });

        if (!res.ok) {
            // Fallback heuristics based on name if /api/show fails
            const isEmbedByName = /embed|bge|minilm|e5-|arctic/i.test(modelId);
            return {
                isEmbedding: isEmbedByName,
                isTextGeneration: !isEmbedByName
            };
        }

        const data = await res.json();
        const arch = (data.model_info?.['general.architecture'] || data.details?.family || '').toLowerCase();
        const hasTemplate = Boolean(data.template && data.template.trim().length > 0);
        const nameSuggestsEmbed = /embed|bge|minilm|e5-|arctic/i.test(modelId);

        // Dedicated embedding models use encoder-only architectures (BERT-family) or lack generation templates
        const isEmbedding = EMBEDDING_ARCHITECTURES.has(arch) || nameSuggestsEmbed || (!hasTemplate && arch.includes('bert'));
        const isTextGeneration = !isEmbedding;

        // Extract context window length
        let contextWindow: number | undefined;
        if (data.model_info) {
            for (const key of Object.keys(data.model_info)) {
                if (key.endsWith('.context_length')) {
                    const val = data.model_info[key];
                    if (typeof val === 'number') {
                        contextWindow = val;
                        break;
                    }
                }
            }
        }

        if (!contextWindow && data.parameters) {
            const match = data.parameters.match(/num_ctx\s+(\d+)/);
            if (match) contextWindow = parseInt(match[1], 10);
        }

        return {
            isEmbedding,
            isTextGeneration,
            contextWindow: contextWindow || (isTextGeneration ? 4096 : undefined),
            family: arch
        };
    } catch {
        const isEmbedByName = /embed|bge|minilm|e5-|arctic/i.test(modelId);
        return {
            isEmbedding: isEmbedByName,
            isTextGeneration: !isEmbedByName
        };
    }
}