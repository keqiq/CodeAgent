import { ToolSchema } from "./toolIndex";

export const commandSchemas: ToolSchema[] = [
    {
        type: "function",
        name: "run",
        description: "Execute a terminal/shell command inside the isolated worktree workspace.\n\n" +
                     "CRITICAL LIMITATIONS:\n" +
                     "1. NO SHELL OPERATORS: Commands are executed directly, not via a shell. You CANNOT use chaining operators (&&, ||, ;, |), subshells, or file redirections (>, <). You must execute commands one at a time.\n" +
                     "2. NON-INTERACTIVE: Commands MUST NOT prompt for user input. Always use '-y', '--force', or similar headless flags.\n" +
                     "3. NO SERVERS/WATCHERS: Do NOT run long-running processes (e.g., 'npm start', '--watch') as they will time out.\n" +
                     "4. PERMISSIONS: Depending on the user's security configuration, some commands may pause execution to request manual approval from the user. Be patient if a command takes longer than usual.",
        parameters: {
            type: "object",
            properties: {
                command: { 
                    type: "string", 
                    description: "A single shell command to execute (e.g., 'npm test', 'git status'). Do NOT include shell operators like '&&' or '|'." 
                },
                cwd: {
                    type: "string",
                    description: "OPTIONAL. The relative path to the directory where the command should be executed. Defaults to '.' (the project root). Directory traversal outside the project root is strictly blocked."
                }
            },
            required: ["command"]
        }
    }
];