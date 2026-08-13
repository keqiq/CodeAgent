import hljs from "highlight.js";
import { marked } from "marked";

const THOUGHT_PHRASES = [
    'Pondering...',
    'Refining ideas...',
    'Working on it...',
    'Connecting the dots...',
    'Mapping out next steps...',
    'Taking a closer look...',
    'Thinking extra hard...'
];

export class ThoughtContainer {
    private activeThoughtDetails: HTMLDetailsElement;
    private activeThoughtContent: HTMLElement;
    private activeThoughtRawText: string = '';
    private thoughtStartTime: number = 0;
    private thoughtTotalTime: number = 0;
    private isThinking: boolean = false;

    constructor(private container: HTMLElement) {
        this.thoughtStartTime = Date.now();

        this.activeThoughtDetails = document.createElement('details');
        this.activeThoughtDetails.classList.add('thought-group');

        const summary = document.createElement('summary');

        // Bouncing dots thinking indicator
        summary.innerHTML = `
            <div class="typing-indicator" style="display:inline-flex; margin-right: 8px;">
                <span></span><span></span><span></span>
            </div> 
            <span>Thinking...</span>
        `;

        this.activeThoughtContent = document.createElement('div');
        this.activeThoughtContent.classList.add('thought-content', 'message', 'agent');

        this.activeThoughtDetails.appendChild(summary);
        this.activeThoughtDetails.appendChild(this.activeThoughtContent);
        this.container.appendChild(this.activeThoughtDetails);
    }

    public streamUpdate(chunk: string): void {
        if (!this.container) return;

        // start or resume thought timer
        if (!this.isThinking) {
            this.thoughtStartTime = Date.now();
            this.isThinking = true;

            // Separate each thought
            if (this.activeThoughtRawText) this.activeThoughtRawText += '\n\n';
        }
        this.activeThoughtRawText += chunk;
        this.activeThoughtContent!.innerHTML = this.parseMarkdown(this.activeThoughtRawText);
    }

    public end(): void {
        if (!this.activeThoughtDetails) return;
        this.pauseThoughtTimer();
        // Update summary with thought duration
        const duration = ((this.thoughtTotalTime) / 1000).toFixed(1);
        const summary = this.activeThoughtDetails.querySelector('summary');
        if (summary) summary.innerHTML = `<span>Thought for ${duration} seconds</span>`;

        // Highlight code blocks
        this.activeThoughtDetails.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block as HTMLElement);
        });
    }

    public pauseThoughtTimer(): void {
        if (this.isThinking) {
            this.thoughtTotalTime += (Date.now() - this.thoughtStartTime);
            this.isThinking = false;

            // Update thought phrase
            if (this.activeThoughtDetails) {
                const summary = this.activeThoughtDetails.querySelector('summary');
                if (summary) {
                    summary.innerHTML = `
                        <div class="typing-indicator" style="display:inline-flex; margin-right: 8px;">
                            <span></span><span></span><span></span>
                        </div> 
                        <span>${this.getRandomThoughtPhrase()}</span>
                    `;
                }
            }
        }
    }

    private getRandomThoughtPhrase(): string {
        return THOUGHT_PHRASES[Math.floor(Math.random() * THOUGHT_PHRASES.length)];
    }

    private parseMarkdown(text: string): string {
        return marked.parse(text, { 
            gfm: true, 
            breaks: false 
        }) as string;
    }
}