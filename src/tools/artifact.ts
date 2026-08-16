import { ToolSchema } from './toolIndex';

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