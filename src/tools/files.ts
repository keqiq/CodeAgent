import * as vscode from 'vscode';
import { getWorkspaceUri, getFileContent } from '../utils/workspace';

export const fileSchemas = [
    {
        name: "read",
        description: "Read the exact contents of a file.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "The relative path to the file in the worksapce." }
            },
            required: ["filePath"]
        }
    },
    {
        name: "write",
        description: "Create a new file or completely overwrite an existing file.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the file."},
                content:  { type: "string", description: "The complete text content to write to the file."}
            },
            required: ["filePath", "content"]
        }

    },
    {
        name: "edit",
        description: "Replace a specific block of text in an existing file.",
        parameters: {
            type: "object",
            properties: {
                filePath: { type: "string", description: "Path to the file."},
                oldText:  { type: "string", description: "The EXACT existing text to be replaced. Must match indentation perfectly."},
                newText:  { type: "string", description: "The new text that will replace the old text."}
            },
            required: ["filePath", "oldText", "newText"]
        }
    }
];

const textDecoder = new TextDecoder('utf-8');
const textEncoder = new TextEncoder();

export async function executeRead(filePath: string): Promise<string> {
    try {

        const fileUri = getWorkspaceUri(filePath);

        const uint8Array = await vscode.workspace.fs.readFile(fileUri);

        return textDecoder.decode(uint8Array);
    } catch (e) {
        return `Error reading file: ${e}`;
    }
}

export async function executeWrite(filePath: string, content: string): Promise<string> {
    try {
        const fileUri = getWorkspaceUri(filePath);
        const uint8Array = textEncoder.encode(content);
        await vscode.workspace.fs.writeFile(fileUri, uint8Array);
        return `Successfully wrote to ${filePath}`;
    } catch (e) {
        return `Error writing file: ${e}`;
    }
}

const normalize = (str: string) => str.replace(/\r\n/g, '\n').replace(/[ \t]+/g, ' ').trim();
export async function executeEdit(filePath: string, oldText: string, newText: string) {
    try {
        const fileUri = getWorkspaceUri(filePath);
        const fileContent = await getFileContent(fileUri);

        // Try stict matching first
        if (fileContent.includes(oldText)) {
            const updatedContent =fileContent.replace(oldText, newText);
            await vscode.workspace.fs.writeFile(fileUri, textEncoder.encode(updatedContent));
            return `Successfully edited ${filePath} with strict matching.`;
        }

        // Whitespace agnostic matching fallback
        const normalizedFile = normalize(fileContent);
        const normalizedOldText = normalize(oldText);

        if (normalizedFile.includes(normalizedOldText)) {
            return "Error: oldText was found, but the indentation or line breaks did not match the file perfectly. Please use readFile to check the exact whitespace and try again.";
        }
        return "Error: oldText was not found in the file at all. Ensure you are targeting the right code.";
    } catch (e) {
        return `Error editing file: ${e}`;
    }
}