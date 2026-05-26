import { searchSchemas, executeGlob, executeGrep } from "./search";
import { fileSchemas, executeRead, executeWrite, executeEdit } from "./files";

export const allToolSchemas = [
    searchSchemas,
    fileSchemas,
];

export const toolRegistry: Record<string, (args: any) => Promise<string>> = {
    "glob":     async (args) => await executeGlob(args.pattern),
    "grep":     async (args) => await executeGrep(args.query, args.filePattern),
    "read":     async (args) => await executeRead(args.filePath),
    "write":    async (args) => await executeWrite(args.filePath, args.content),
    "edit":     async (args) => await executeEdit(args.filePath, args.oldText, args.newText)
};