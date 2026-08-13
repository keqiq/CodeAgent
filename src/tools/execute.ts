import * as cp from 'child_process';
import { ToolResult, ToolSchema } from "./toolIndex";

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

// export const commandSchemas: ToolSchema[] = [
//     {
//         type: "function",
//         name: "run",
//         description: "Execute a terminal/shell command inside the isolated worktree workspace. " +
//                      "Use this for running tests, build tasks, linters, or checking tool versions. " +
//                      "IMPORTANT: Commands MUST be non-interactive (e.g., use '-y' or '--force' flags). " +
//                      "Do NOT run long-running servers or watch commands (e.g., 'npm start', 'npm run dev', '--watch') as they will time out.",
//         parameters: {
//             type: "object",
//             properties: {
//                 command: { 
//                     type: "string", 
//                     description: "The shell command to execute (e.g., 'npm test', 'cargo check', 'git status')." 
//                 }
//             },
//             required: ["command"]
//         }
//     }
// ];

// TODO: Pretty dangerous as it allows any command, add some safety nets
// export async function executeRun(command: string, cwd: string, signal: AbortSignal): Promise<ToolResult> {
//     return new Promise((resolve, reject) => {
//         if (signal.aborted) return reject(new Error('AbortError'));
        
//         const child = cp.exec(command, { cwd, timeout: 30_000 }, (error, stdout, stderr) => {
//             signal.removeEventListener('abort', abortListener);
            
//             let output = '';
//             if (stdout) output += `STDOUT:\n${truncateOutput(stdout)}\n`;
//             if (stderr) output += `STDERR:\n${truncateOutput(stderr)}\n`;
            
//             if (error) {
//                 // If killed by timeout option
//                 if (error.killed) return reject(new Error(`[Process killed: Exceeded timeout]\n${output}`.trim()));
//                 else return reject(new Error(`[Exit Code: ${error.code}]\n${output}`));
//             }
            
//             resolve({ message: output.trim() || "Command executed successfully with no output.".trim()});
//         });
        
//         const abortListener = () => {
//             child.kill();
//             reject(new Error('AbortError'));
//         };

//         signal.addEventListener('abort', abortListener);
//     });
// }

// function truncateOutput(text: string, maxLen = 3000): string {
//     if (text.length <= maxLen) return text;
//     const half = Math.floor(maxLen / 2);
//     return `${text.slice(0, half)}\n\n...[TRUNCATED]...\n\n${text.slice(-half)}`;
// }