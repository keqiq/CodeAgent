import { LanguageConfig } from "./_languageTypes";
import { javascriptChunkConfig } from "./javascript";
import { cChunkConfig } from "./c";
import { cppChunkConfig } from "./cpp";
import { csharpChunkConfig } from "./csharp";
import { javaChunkConfig } from "./java";
import { pythonChunkConfig } from "./python";
import { rustChunkConfig } from "./rust";
import { goChunkConfig } from "./go";


export const languageConfigs = new Map<string, LanguageConfig>([
    [".ts", {
        ...javascriptChunkConfig,
        wasmFile: "tree-sitter-typescript.wasm"
    }],
    [".tsx", {
        ...javascriptChunkConfig,
        wasmFile: "tree-sitter-tsx.wasm"
    }],
    [".js", {
        ...javascriptChunkConfig,
        wasmFile: "tree-sitter-javascript.wasm"
    }],
    [".jsx", {
        ...javascriptChunkConfig,
        wasmFile: "tree-sitter-javascript.wasm"
    }],
    [".c", {
        ...cChunkConfig,
        wasmFile: "tree-sitter-c.wasm"
    }],
    [".cpp", {
        ...cppChunkConfig,
        wasmFile: "tree-sitter-cpp.wasm"
    }],
    [".hpp", {
        ...cppChunkConfig,
        wasmFile: "tree-sitter-cpp.wasm"
    }],
    [".h", {
        ...cppChunkConfig,
        wasmFile: "tree-sitter-cpp.wasm"
    }],

    [".cs", {
        ...csharpChunkConfig,
        wasmFile: "tree-sitter-c_sharp.wasm"
    }],
    [".java", {
        ...javaChunkConfig,
        wasmFile: "tree-sitter-java.wasm"
    }],
    [".py", {
        ...pythonChunkConfig,
        wasmFile: "tree-sitter-python.wasm"
    }],
    [".rs", {
        ...rustChunkConfig,
        wasmFile: "tree-sitter-rust.wasm"
    }],
    [".go", {
        ...goChunkConfig,
        wasmFile: "tree-sitter-go.wasm"
    }]

]);
export const supportedExtensions = [...languageConfigs.keys()];

export const includePattern = `**/*.{${supportedExtensions
    .map(ext => ext.slice(1))
    .join(",")}}`;

export const globalExcludePatterns = [
    "**/.git/**",
    "**/.svn/**",
    "**/.hg/**",

    "**/node_modules/**",
    "**/dist/**",
    "**/out/**",
    "**/build/**",
    "**/.next/**",
    "**/coverage/**",

    "**/.DS_Store",
    "**/*.vsix",

    // Agent worktrees — temporary copies of the repo created for agent runs.
    // These don't need indexing and cause ENOENT errors when cleaned up.
    "**/.agent-worktree-*/**",
];

export const languageExcludePatterns = [
    // Python
    "**/__pycache__/**",
    "**/.venv/**",
    "**/venv/**",
    "**/.mypy_cache/**",
    "**/.pytest_cache/**",
    "**/.ruff_cache/**",

    // Rust
    "**/target/**",

    // Go
    "**/vendor/**",

    // Java / JVM
    "**/.gradle/**",
    "**/.idea/**",
    "**/target/**",

    // C / C++
    "**/cmake-build-*/**",
    "**/CMakeFiles/**",

    // C#
    "**/bin/**",
    "**/obj/**",
];

export const excludePattern = `{${[
    ...globalExcludePatterns,
    ...languageExcludePatterns,
].join(",")}}`;