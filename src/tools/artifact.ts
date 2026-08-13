import { ContextManager } from '../managers/contextManager';
import { ToolResult, ToolSchema } from './toolIndex';

export const artifactSchema: ToolSchema[] = [
    {
        type: "function",
        name: "recall",
        description: "Retrieve previous tool results from an artifact.",
        parameters: {
            type: "object",
            properties: {
                artifactID: {
                    type: "string",
                    description: "The id for the artifact to retrieve."
                }
            },
            required: ["artifactID"]
        }
    }
];

export async function executeRecall(artifactID: string, contextManager: ContextManager, signal: AbortSignal): Promise<ToolResult> {
    return { 
        message: await contextManager.readArtifact(artifactID),
        data: { artifactID }
    };
}