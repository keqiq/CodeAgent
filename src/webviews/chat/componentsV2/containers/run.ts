import type { TokenUsage } from "../../../../managers/contextManager";
import { PROVIDER_ICONS } from "../../providerIcons";

export class RunContainer {
    private activeRunContainer: HTMLElement;
    public activeRunContent: HTMLElement;
    private activeRunFooter: HTMLElement;

    private tabsContainer: HTMLElement;
    private modelTab: HTMLElement;
    private tokenTab: HTMLElement;
    private speedTab: HTMLElement;
    private statusTab: HTMLElement;

    constructor(private masterContainer: HTMLElement, provider?: string, modelName?: string) {
        // All responses, tool calls, shell commands are contained inside the run container
        this.activeRunContainer = document.createElement('div');
        this.activeRunContainer.classList.add('run-container');
        
        this.activeRunContent = document.createElement('div');
        this.activeRunContent.classList.add('run-content');

        // The footer shows which model was used to generate the response
        // The token usage reported by the provider
        // And any status messages like interrupts or error
        this.activeRunFooter = document.createElement('div');
        this.activeRunFooter.classList.add('run-footer', 'footer-normal');

        this.tabsContainer = document.createElement('div');
        this.tabsContainer.classList.add('run-tabs');

        // Model & Provider tab
        this.modelTab = document.createElement('div');
        this.modelTab.classList.add('run-tab', 'model-tab');
        
        const iconSvg = this.getProviderIcon(provider);
        this.modelTab.innerHTML = `
            <span class="provider-icon">${iconSvg}</span>
            <span class="tab-text model-name-text">${modelName || 'agent'}</span>
        `;
        if (!modelName && !provider) {
            this.modelTab.style.display = 'none';
        }

        // Token tab reporting token usage from provider
        this.tokenTab = document.createElement('div');
        this.tokenTab.classList.add('run-tab', 'token-tab');
        this.tokenTab.innerHTML = `
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <path d="M8 2a6 6 0 1 0 0 12A6 6 0 0 0 8 2zm0 11a5 5 0 1 1 0-10 5 5 0 0 1 0 10zm.5-7.5h-1v4h1v-4zm0 5h-1v1h1v-1z"/>
            </svg>
            <span class="tab-text token-total-text">0 Tokens</span>
        `;
        this.tokenTab.style.display = 'none';

        // Speed tab calculated token/s counter
        this.speedTab = document.createElement('div');
        this.speedTab.classList.add('run-tab', 'speed-tab');
        this.speedTab.innerHTML = `
            <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <path d="M11.251.068a.5.5 0 0 1 .42.58L10.026 6H14a.5.5 0 0 1 .372.832l-9 10a.5.5 0 0 1-.844-.504L6.173 10H2a.5.5 0 0 1-.372-.832l9-10a.5.5 0 0 1 .623-.099z"/>
            </svg>
            <span class="tab-text speed-text">0 t/s</span>
        `;
        this.speedTab.style.display = 'none';

        // Status tab
        this.statusTab = document.createElement('div');
        this.statusTab.classList.add('run-tab', 'status-tab');
        this.statusTab.style.display = 'none';

        this.tabsContainer.appendChild(this.modelTab);
        this.tabsContainer.appendChild(this.tokenTab);
        this.tabsContainer.appendChild(this.speedTab);
        this.tabsContainer.appendChild(this.statusTab);

        this.activeRunFooter.appendChild(this.tabsContainer);
        this.activeRunContainer.appendChild(this.activeRunContent);
        this.activeRunContainer.appendChild(this.activeRunFooter);

        this.masterContainer.appendChild(this.activeRunContainer);
    }
    
    private getProviderIcon(provider?: string): string {
        if (!provider) return PROVIDER_ICONS.default;
        const key = provider.toLowerCase();
        return PROVIDER_ICONS[key] || PROVIDER_ICONS.default;
    }
    
    public setModel(modelName: string, provider?: string): void {
        const textSpan = this.modelTab.querySelector('.model-name-text');
        const iconSpan = this.modelTab.querySelector('.provider-icon');
        
        if (textSpan) textSpan.textContent = modelName;
        if (iconSpan && provider) iconSpan.innerHTML = this.getProviderIcon(provider);
        
        this.modelTab.style.display = 'inline-flex';
    }

    public setSpeed(speed: string, isStreaming: boolean = false): void {
        this.speedTab.classList.add('streaming');
        this.speedTab.style.display = 'inline-flex';
        const speedSpan = this.speedTab.querySelector('.speed-text');
        if (speedSpan) speedSpan.textContent = `${speed} t/s`;
    }
    
    public update(usage: TokenUsage): void {
        if (!usage) return;

        this.speedTab.classList.remove('streaming');

        // Total tokens reported by provider
        this.tokenTab.style.display = 'inline-flex';
        const total = usage.totalTokens || 0;
        const formattedTotal = total >= 10000 
            ? `${(total / 1000).toFixed(1)}k` 
            : total.toLocaleString();

        const tokenSpan = this.tokenTab.querySelector('.token-total-text');
        if (tokenSpan) tokenSpan.textContent = `${formattedTotal} Tokens`;
        this.tokenTab.title = `Input: ${(usage.inputTokens || 0).toLocaleString()}\nOutput: ${(usage.outputTokens || 0).toLocaleString()}\nThought: ${(usage.thoughtTokens || 0).toLocaleString()}`;    
    }

    public end(status: 'ok' | 'aborted' | 'error', message?: string): void {
        if (!this.activeRunFooter || !this.statusTab) return;

        if (status === 'aborted') {
            this.activeRunFooter.classList.replace('footer-normal', 'footer-aborted');
            this.statusTab.className = 'run-tab status-tab status-aborted';
            this.statusTab.style.display = 'inline-flex';
            this.statusTab.innerHTML = `
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm8-3.5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 018 4.5zm0 6a1 1 0 100-2 1 1 0 000 2z"/>
                </svg>
                <span class="tab-text">${message || 'Cancelled'}</span>
            `;
        } else if (status === 'error') {
            this.activeRunFooter.classList.replace('footer-normal', 'footer-error');
            this.statusTab.className = 'run-tab status-tab status-error';
            this.statusTab.style.display = 'inline-flex';
            this.statusTab.innerHTML = `
                <svg width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M8 1.5a6.5 6.5 0 100 13 6.5 6.5 0 000-13zM0 8a8 8 0 1116 0A8 8 0 010 8zm4.22 4.22a.75.75 0 011.06 0L8 6.94l2.72-2.72a.75.75 0 111.06 1.06L9.06 8l2.72 2.72a.75.75 0 11-1.06 1.06L8 9.06l-2.72 2.72a.75.75 0 01-1.06-1.06L6.94 8 4.22 5.28a.75.75 0 010-1.06z"/>
                </svg>
                <span class="tab-text">${message || 'Error'}</span>
            `;
        } else {
            this.statusTab.style.display = 'none';
        }
    }
}