import hljs from "highlight.js";
import { marked } from "marked";
import { ChatItem } from "../../../managers/contextManager";

export class MessageContainer {
    private activeStreamDiv: HTMLElement | null = null;
    private activeStreamRawText: string = "";

    constructor(private container: HTMLElement) {}

    // For agent responses streaming
    public streamUpdate(chunk: string): void {

        if (!this.activeStreamDiv) {
            this.activeStreamDiv = document.createElement('div');
            this.activeStreamDiv.classList.add('message', 'agent');
            this.container.appendChild(this.activeStreamDiv);
        }
        this.activeStreamRawText += chunk;
        this.activeStreamDiv.innerHTML = MessageContainer.parseMarkdown(this.activeStreamRawText);
    }

    public end(): void {
        if (!this.activeStreamDiv) return;

        // Highlight code blocks
        this.activeStreamDiv.querySelectorAll('pre code').forEach((block) =>  {
            hljs.highlightElement(block as HTMLElement);
        });
    }

    private static parseMarkdown(text: string): string {
        return marked.parse(text, { 
            gfm: true, 
            breaks: false 
        }) as string;
    }

    public add(msg: Extract<ChatItem, { type: 'message' }> & { style?: string }): void {

        if (msg.isHidden) return;

        const text = msg.content || '';
        const role = msg.role;

        const msgDiv = document.createElement('div');
        
        // Map 'assistant' role to 'agent' class for CSS consistency
        const cssClass = role === 'assistant' ? 'agent' : role;
        msgDiv.classList.add('message', cssClass);

        // Apply optional style class for interrupt/error messages
        if (msg.style) {
            msgDiv.classList.add(msg.style);
        }

        // Agent messages, need markdown parsing and code highlight
        if (role === 'assistant') {
            msgDiv.innerHTML = MessageContainer.parseMarkdown(text);
            msgDiv.querySelectorAll('pre code').forEach((block) => {
                hljs.highlightElement(block as HTMLElement);
            });
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