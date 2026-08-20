export interface OllamaModelMeta {
    isEmbedding: boolean;
    isTextGeneration: boolean;
    isReasoning: boolean;
    efforts: string[];
    defaultEffort: string | null;
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

const REASONING_NAME_REGEX = /r1|qwq|reason|think|qwen3|gpt-oss/i;
const REASONING_TEMPLATE_REGEX = /<think>|<\|begin_of_thought\|>|\.Think|\.IsThinkSet/;

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

        const isEmbedByName = /embed|bge|minilm|e5-|arctic/i.test(modelId);

        if (!res.ok) {
            const isReasoning = REASONING_NAME_REGEX.test(modelId);
            return {
                isEmbedding: isEmbedByName,
                isTextGeneration: !isEmbedByName,
                isReasoning,
                efforts: isReasoning ? ['none', 'low', 'medium', 'high', 'max'] : [],
                defaultEffort: isReasoning ? 'medium' : null
            };
        }

        const data = await res.json();
        const arch = (data.model_info?.['general.architecture'] || data.details?.family || '').toLowerCase();
        const template = data.template || '';
        const hasTemplate = Boolean(template.trim().length > 0);

        // Embedding detection
        const isEmbedding = EMBEDDING_ARCHITECTURES.has(arch) || isEmbedByName || (!hasTemplate && arch.includes('bert'));
        const isTextGeneration = !isEmbedding;

        // Reasoning detection
        const hasThinkingCapability = Array.isArray(data.capabilities) && data.capabilities.includes('thinking');
        const hasThinkingTemplate = REASONING_TEMPLATE_REGEX.test(template);
        const isReasoning = isTextGeneration && (hasThinkingCapability || hasThinkingTemplate || REASONING_NAME_REGEX.test(modelId));

        // Supported effort levels
        let efforts: string[] = [];
        let defaultEffort: string | null = null;

        if (isReasoning) {
            // Models like gpt-oss support low/medium/high, most others (e.g. Qwen3/DeepSeek) support none -> max
            if (modelId.toLowerCase().includes('gpt-oss')) {
                efforts = ['low', 'medium', 'high'];
                defaultEffort = 'medium';
            } else {
                efforts = ['none', 'low', 'medium', 'high', 'max'];
                defaultEffort = 'medium';
            }
        }

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
            isReasoning,
            efforts,
            defaultEffort,
            contextWindow: contextWindow || (isTextGeneration ? 4096 : undefined),
            family: arch
        };
    } catch {
        const isEmbedByName = /embed|bge|minilm|e5-|arctic/i.test(modelId);
        const isReasoning = REASONING_NAME_REGEX.test(modelId);
        return {
            isEmbedding: isEmbedByName,
            isTextGeneration: !isEmbedByName,
            isReasoning,
            efforts: isReasoning ? ['none', 'low', 'medium', 'high', 'max'] : [],
            defaultEffort: isReasoning ? 'medium' : null
        };
    }
}