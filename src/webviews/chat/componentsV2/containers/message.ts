import { parseMarkdown } from "../../../markdownRenderer";
import type { ChatItem } from "../../../../managers/contextManager";

export class MessageContainer {
    private activeStreamDiv: HTMLElement | null = null;
    private activeStreamRawText: string = "";

    constructor(private container: HTMLElement) {
        this.initListeners();
    }

    private initListeners(): void {
        // Event for code block copy buttons
        this.container.addEventListener('click', async (e: MouseEvent) => {
            const target = e.target as HTMLElement;
            const copyBtn = target.closest('.copy-code-btn') as HTMLButtonElement | null;
            if (!copyBtn) return;

            e.stopPropagation();
            const rawCode = decodeURIComponent(copyBtn.getAttribute('data-code') || '');

            try {
                await navigator.clipboard.writeText(rawCode);
                const textSpan = copyBtn.querySelector('span');
                if (textSpan) textSpan.textContent = 'Copied!';
                copyBtn.classList.add('copied');

                setTimeout(() => {
                    if (textSpan) textSpan.textContent = 'Copy';
                    copyBtn.classList.remove('copied');
                }, 1800);
            } catch (err) {
                console.error('Failed to copy code to clipboard:', err);
            }
        });
    }

    // For agent responses streaming
    public streamUpdate(chunk: string): void {

        if (!this.activeStreamDiv) {
            this.activeStreamDiv = document.createElement('div');
            this.activeStreamDiv.classList.add('message', 'agent');
            this.container.appendChild(this.activeStreamDiv);
        }
        this.activeStreamRawText += chunk;
        this.activeStreamDiv.innerHTML = parseMarkdown(this.activeStreamRawText);
    }

    public end(): void {
        if (!this.activeStreamDiv) return;
    }

    public add(msg: Extract<ChatItem, { type: 'message' }> & { style?: string }): void {

        if (msg.isHidden) return;

        const text = msg.content || '';
        const role = msg.role;

        const msgDiv = document.createElement('div');
        
        // Map 'assistant' role to 'agent' class for CSS consistency
        const cssClass = role === 'assistant' ? 'agent' : role;
        msgDiv.classList.add('message', cssClass);

        // Apply optional style class summary
        if (msg.style)  msgDiv.classList.add(msg.style);

        // Agent messages, need markdown parsing and code highlight
        if (role === 'assistant') {
            msgDiv.innerHTML = parseMarkdown(text);
            this.container.appendChild(msgDiv);
        }

        // User messages need to be collapsable
        else if (role === 'user') {
            const textContainer = document.createElement('div');
            textContainer.classList.add('user-text-content');
            textContainer.textContent = text;
            msgDiv.appendChild(textContainer);

            const lineCount = text.split('\n').length;
            if (text.length > 250 || lineCount > 5) {
                textContainer.classList.add('clamped');
                const toggleBtn = document.createElement('button');
                toggleBtn.classList.add('toggle-text-btn');
                toggleBtn.textContent = 'Show More';

                toggleBtn.addEventListener('click', () => {
                    if (textContainer.classList.contains('clamped')) {
                        textContainer.classList.remove('clamped');
                        toggleBtn.textContent = 'Show Less';
                    }
                    else {
                        textContainer.classList.add('clamped');
                        toggleBtn.textContent = 'Show More';
                        msgDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                    }
                });
                msgDiv.appendChild(toggleBtn);
            }
            this.container.appendChild(msgDiv);
        }
    }
}