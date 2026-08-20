import { marked } from "marked";
import { createHighlighter, type Highlighter } from "shiki";

let highlighter: Highlighter | null = null;
let isHighlighterReady = false;

// Comprehensive alias dictionary mapping LLM markdown outputs to Shiki IDs
const LANGUAGE_ALIASES: Record<string, string> = {
    ts: 'typescript',
    tsx: 'tsx',
    js: 'javascript',
    jsx: 'jsx',
    mjs: 'javascript',
    cjs: 'javascript',
    py: 'python',
    py3: 'python',
    rb: 'ruby',
    rs: 'rust',
    go: 'go',
    golang: 'go',
    cs: 'csharp',
    'c#': 'csharp',
    cpp: 'cpp',
    'c++': 'cpp',
    c: 'c',
    java: 'java',
    kt: 'kotlin',
    swift: 'swift',
    php: 'php',
    sh: 'bash',
    bash: 'bash',
    zsh: 'bash',
    shell: 'bash',
    ps1: 'powershell',
    powershell: 'powershell',
    sql: 'sql',
    html: 'html',
    css: 'css',
    scss: 'scss',
    sass: 'scss',
    less: 'less',
    json: 'json',
    jsonc: 'jsonc',
    yaml: 'yaml',
    yml: 'yaml',
    toml: 'toml',
    xml: 'xml',
    svg: 'xml',
    md: 'markdown',
    markdown: 'markdown',
    docker: 'dockerfile',
    dockerfile: 'dockerfile',
    graphql: 'graphql',
    gql: 'graphql',
    proto: 'proto',
    diff: 'diff',
    makefile: 'makefile',
    make: 'makefile',
    ini: 'ini',
    env: 'ini'
};

function resolveLanguage(rawLang: string): string {
    const clean = (rawLang || '').trim().toLowerCase().split(/\s+/)[0];
    return LANGUAGE_ALIASES[clean] || clean || 'text';
}

function getVSCodeTheme(): 'dark-plus' | 'light-plus' {
    const isLight = document.body.classList.contains('vscode-light');
    return isLight ? 'light-plus' : 'dark-plus';
}

// Initialize Shiki on load
async function initShiki() {
    try {
        highlighter = await createHighlighter({
            themes: ['dark-plus', 'light-plus'],
            langs: [
                'typescript', 'tsx', 'javascript', 'jsx',
                'python', 'ruby', 'rust', 'go', 'csharp',
                'cpp', 'c', 'java', 'kotlin', 'swift', 'php',
                'bash', 'powershell', 'sql', 'html', 'css',
                'scss', 'json', 'jsonc', 'yaml', 'toml', 'xml',
                'markdown', 'dockerfile', 'graphql', 'proto',
                'diff', 'makefile', 'ini'
            ]
        });
        isHighlighterReady = true;

        // Re-highlight any plain code blocks rendered during startup
        document.querySelectorAll('.md-code-block[data-needs-shiki="true"]').forEach((preEl) => {
            const codeEl = preEl.querySelector('code');
            const lang = preEl.getAttribute('data-lang') || 'text';
            if (codeEl && highlighter) {
                const rawCode = decodeURIComponent(preEl.getAttribute('data-raw-code') || '');
                const targetLang = highlighter.getLoadedLanguages().includes(lang) ? lang : 'text';
                const highlighted = highlighter.codeToHtml(rawCode, {
                    lang: targetLang,
                    theme: getVSCodeTheme()
                });
                preEl.outerHTML = highlighted;
            }
        });
    } catch (err) {
        console.error('[Shiki] Failed to initialize syntax highlighter:', err);
    }
}

initShiki();

// Configure Marked custom renderers
marked.use({
    gfm: true,
    breaks: false,
    renderer: {
        table(this: any, tokenOrHeader: any, body?: string) {
            if (typeof tokenOrHeader === 'string') {
                return `
                    <div class="table-wrapper">
                        <table>
                            <thead>${tokenOrHeader}</thead>
                            <tbody>${body || ''}</tbody>
                        </table>
                    </div>
                `;
            }

            const token = tokenOrHeader;
            let headerHtml = '';
            if (token.header && Array.isArray(token.header)) {
                let cellsHtml = '';
                for (const cell of token.header) cellsHtml += this.tablecell(cell);
                headerHtml = this.tablerow({ text: cellsHtml });
            }

            let bodyHtml = '';
            if (token.rows && Array.isArray(token.rows)) {
                for (const row of token.rows) {
                    let cellsHtml = '';
                    for (const cell of row) cellsHtml += this.tablecell(cell);
                    bodyHtml += this.tablerow({ text: cellsHtml });
                }
            }

            return `
                <div class="table-wrapper">
                    <table>
                        <thead>${headerHtml}</thead>
                        ${bodyHtml ? `<tbody>${bodyHtml}</tbody>` : ''}
                    </table>
                </div>
            `;
        },

        code(codeOrToken: any, infostring?: string) {
            const text = typeof codeOrToken === 'string' ? codeOrToken : codeOrToken.text;
            const rawLang = typeof codeOrToken === 'string' ? infostring : codeOrToken.lang;
            const canonicalLang = resolveLanguage(rawLang || '');

            let highlightedHtml = '';
            const encodedCode = encodeURIComponent(text);

            if (isHighlighterReady && highlighter && highlighter.getLoadedLanguages().includes(canonicalLang)) {
                highlightedHtml = highlighter.codeToHtml(text, {
                    lang: canonicalLang,
                    theme: getVSCodeTheme()
                });
            } else {
                const escaped = text
                    .replace(/&/g, "&amp;")
                    .replace(/</g, "&lt;")
                    .replace(/>/g, "&gt;");
                highlightedHtml = `<pre class="shiki md-code-block" data-needs-shiki="${!isHighlighterReady}" data-lang="${canonicalLang}" data-raw-code="${encodedCode}"><code>${escaped}</code></pre>`;
            }

            return `
                <div class="code-block-container">
                    <div class="code-block-header">
                        <span class="code-lang">${canonicalLang}</span>
                        <button type="button" class="copy-code-btn" data-code="${encodedCode}" title="Copy Code">
                            <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
                                <path fill-rule="evenodd" clip-rule="evenodd" d="M4 4h7V2H4a2 2 0 0 0-2 2v8h2V4zm9 2H6a1 1 0 0 0-1 1v7a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1V7a1 1 0 0 0-1-1zm0 8H6V7h7v7z"/>
                            </svg>
                            <span>Copy</span>
                        </button>
                    </div>
                    ${highlightedHtml}
                </div>
            `;
        }
    }
});

export function parseMarkdown(text: string): string {
    return marked.parse(text) as string;
}