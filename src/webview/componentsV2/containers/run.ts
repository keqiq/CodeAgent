import { TokenUsage } from "../../../contextManager";

export class RunContainer {
    private activeRunContainer: HTMLElement;
    public activeRunContent: HTMLElement;
    private activeRunFooter: HTMLElement;
    private tokenUsageElement: HTMLElement;
    private runStatusElement: HTMLElement;

    constructor(private masterContainer: HTMLElement) {
        this.activeRunContainer = document.createElement('div');
        this.activeRunContainer.classList.add('run-container');

        // The content container has all the messages, thoughts, tools, patches
        this.activeRunContent = document.createElement('div');
        this.activeRunContent.classList.add('run-content');

        // The footer contains token usage and abort and error indicators
        this.activeRunFooter = document.createElement('div');
        this.activeRunFooter.classList.add('run-footer', 'footer-normal');

        // token usage display on the left
        this.tokenUsageElement = document.createElement('div');
        this.tokenUsageElement.classList.add('token-usage-container');
        this.tokenUsageElement.innerHTML = `
            <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 11a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm.5-7.5h-1v4h1v-4zm0 5h-1v1h1v-1z"/>
            </svg>
            <span class="token-total-text">0 Tokens</span>
        `;
        this.tokenUsageElement.style.display = 'none'; // hide on init until we have data

        // status like user interrupt or error
        this.runStatusElement = document.createElement('div');
        this.runStatusElement.classList.add('run-status');

        this.activeRunFooter.appendChild(this.tokenUsageElement);
        this.activeRunFooter.appendChild(this.runStatusElement);

        this.activeRunContainer.appendChild(this.activeRunContent);
        this.activeRunContainer.appendChild(this.activeRunFooter);

        this.masterContainer.appendChild(this.activeRunContainer);
    }

    public update(usage: TokenUsage): void {
        if (!this.tokenUsageElement || !usage) return;

        this.tokenUsageElement.style.display = 'flex';

        const textSpan = this.tokenUsageElement.querySelector('.token-total-text');
        if (textSpan) textSpan.textContent = `${usage.totalTokens || 0} Tokens`;

        this.tokenUsageElement.title = `Input: ${usage.inputTokens || 0}\nOutput: ${usage.outputTokens || 0}\nThought: ${usage.thoughtTokens || 0}`;
    }

     public end(status: 'ok' | 'aborted' | 'error', message?: string): void {
        if (!this.activeRunFooter || !this.runStatusElement) return;

        if (status === 'aborted') {
            this.activeRunFooter.classList.replace('footer-normal', 'footer-aborted');
            this.runStatusElement.textContent = message || 'Aborted';
        } 
        else if (status === 'error') {
            this.activeRunFooter.classList.replace('footer-normal', 'footer-error');
            this.runStatusElement.textContent = message || 'Error';
        } else {
            this.runStatusElement.textContent = '';
        }
    }
}