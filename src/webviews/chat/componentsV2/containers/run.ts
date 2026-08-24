import type { TokenUsage } from "../../../../managers/contextManager";
import { PROVIDER_ICONS } from "../../providerIcons";

export class RunContainer {
    private activeRunContainer: HTMLElement;
    public activeRunContent: HTMLElement;
    private activeRunFooter: HTMLElement;

    private tabsContainer: HTMLElement;
    private modelTab: HTMLElement;
    private turnTab: HTMLElement;
    private tokenTab: HTMLElement;
    private speedTab: HTMLElement;
    private statusTab: HTMLElement;
    private checkpointTab: HTMLElement | null = null;

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

        // Turn tab showing current agent loop progress
        this.turnTab = document.createElement('div');
        this.turnTab.classList.add('run-tab', 'turn-tab');
        this.turnTab.innerHTML = `
            <svg class="turn-icon" width="11" height="11" viewBox="0 0 16 16" fill="currentColor">
                <path fill-rule="evenodd" clip-rule="evenodd" d="M8 3a5 5 0 1 0 4.546 2.914.5.5 0 0 1 .908-.417A6 6 0 1 1 8 2v1z"/>
                <path d="M8 0a.5.5 0 0 1 .5.5v3a.5.5 0 0 1-.5.5H5a.5.5 0 0 1 0-1h2.5V.5A.5.5 0 0 1 8 0z"/>
            </svg>
            <span class="tab-text turn-text">1</span>
        `;
        this.turnTab.style.display = 'none';

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
        this.tabsContainer.appendChild(this.turnTab);
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

    public setTurn(current: number, limit: number): void {
        this.turnTab.style.display = 'inline-flex';

        const textSpan = this.turnTab.querySelector('.turn-text');
        const icon = this.turnTab.querySelector('.turn-icon') as SVGElement | null;

        if (textSpan) {
            textSpan.textContent = limit > 0 ? `${current}/${limit}` : `${current}`;
        }

        // Trigger exactly 1 full rotation smoothly
        if (icon) {
            icon.animate(
                [
                    { transform: 'rotate(0deg)' },
                    { transform: 'rotate(360deg)' }
                ],
                {
                    duration: 600,
                    easing: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
                    iterations: 1
                }
            );
        }
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
                <svg width="11" height="11" viewBox="0 0 16 16" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"><path d="M7.493 0.015 C 7.442 0.021,7.268 0.039,7.107 0.055 C 5.234 0.242,3.347 1.208,2.071 2.634 C 0.660 4.211,-0.057 6.168,0.009 8.253 C 0.124 11.854,2.599 14.903,6.110 15.771 C 8.169 16.280,10.433 15.917,12.227 14.791 C 14.017 13.666,15.270 11.933,15.771 9.887 C 15.943 9.186,15.983 8.829,15.983 8.000 C 15.983 7.171,15.943 6.814,15.771 6.113 C 14.979 2.878,12.315 0.498,9.000 0.064 C 8.716 0.027,7.683 -0.006,7.493 0.015 M8.853 1.563 C 9.967 1.707,11.010 2.136,11.944 2.834 C 12.273 3.080,12.920 3.727,13.166 4.056 C 13.727 4.807,14.142 5.690,14.330 6.535 C 14.544 7.500,14.544 8.500,14.330 9.465 C 13.916 11.326,12.605 12.978,10.867 13.828 C 10.239 14.135,9.591 14.336,8.880 14.444 C 8.456 14.509,7.544 14.509,7.120 14.444 C 5.172 14.148,3.528 13.085,2.493 11.451 C 2.279 11.114,1.999 10.526,1.859 10.119 C 1.618 9.422,1.514 8.781,1.514 8.000 C 1.514 6.961,1.715 6.075,2.160 5.160 C 2.500 4.462,2.846 3.980,3.413 3.413 C 3.980 2.846,4.462 2.500,5.160 2.160 C 6.313 1.599,7.567 1.397,8.853 1.563 M7.706 4.290 C 7.482 4.363,7.355 4.491,7.293 4.705 C 7.257 4.827,7.253 5.106,7.259 6.816 C 7.267 8.786,7.267 8.787,7.325 8.896 C 7.398 9.033,7.538 9.157,7.671 9.204 C 7.803 9.250,8.197 9.250,8.329 9.204 C 8.462 9.157,8.602 9.033,8.675 8.896 C 8.733 8.787,8.733 8.786,8.741 6.816 C 8.749 4.664,8.749 4.662,8.596 4.481 C 8.472 4.333,8.339 4.284,8.040 4.276 C 7.893 4.272,7.743 4.278,7.706 4.290 M7.786 10.530 C 7.597 10.592,7.410 10.753,7.319 10.932 C 7.249 11.072,7.237 11.325,7.294 11.495 C 7.388 11.780,7.697 12.000,8.000 12.000 C 8.303 12.000,8.612 11.780,8.706 11.495 C 8.763 11.325,8.751 11.072,8.681 10.932 C 8.616 10.804,8.460 10.646,8.333 10.580 C 8.217 10.520,7.904 10.491,7.786 10.530 " stroke="none" fill-rule="evenodd" fill="currentColor"></path></g></svg>
                <span class="tab-text">Error</span>
            `;
            this.statusTab.title = ` ${message}`;
        } else {
            this.statusTab.style.display = 'none';
        }
    }

    public setCheckpoint(): void {
        if (!this.checkpointTab) {
            this.checkpointTab = document.createElement('div');
            this.checkpointTab.classList.add('run-tab', 'checkpoint-tab');
            this.checkpointTab.innerHTML = `
                <svg width="11" height="11" viewBox="0 -0.5 25 25" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M7 12.5538H6.25C6.25 12.5713 6.25061 12.5888 6.25183 12.6062L7 12.5538ZM7.782 13.2398V12.4898C7.76683 12.4898 7.75167 12.4903 7.73653 12.4912L7.782 13.2398ZM17.217 13.2398L17.3055 12.4951C17.2761 12.4916 17.2466 12.4898 17.217 12.4898V13.2398ZM17.8805 12.9231L18.5153 13.3225V13.3225L17.8805 12.9231ZM17.879 12.1878L18.5121 11.7858C18.5046 11.7739 18.4967 11.7622 18.4885 11.7508L17.879 12.1878ZM15.943 9.48782L16.5526 9.05075L16.5467 9.04282L15.943 9.48782ZM15.943 8.75682L16.5468 9.20187L16.5525 9.19386L15.943 8.75682ZM17.879 6.05682L18.4885 6.49386C18.4967 6.48242 18.5046 6.47075 18.5121 6.45887L17.879 6.05682ZM17.8805 5.32159L18.5153 4.92214L18.5153 4.92214L17.8805 5.32159ZM17.217 5.00482V5.75482C17.2466 5.75482 17.2761 5.75307 17.3055 5.74958L17.217 5.00482ZM7.782 5.00482L7.73653 5.75344C7.75167 5.75436 7.76683 5.75482 7.782 5.75482V5.00482ZM7 5.69082L6.25183 5.63841C6.25061 5.65586 6.25 5.67334 6.25 5.69082H7ZM7.75 12.5538C7.75 12.1396 7.41421 11.8038 7 11.8038C6.58579 11.8038 6.25 12.1396 6.25 12.5538H7.75ZM6.25 19.0048C6.25 19.419 6.58579 19.7548 7 19.7548C7.41421 19.7548 7.75 19.419 7.75 19.0048H6.25ZM6.25183 12.6062C6.30892 13.4212 7.01201 14.038 7.82747 13.9884L7.73653 12.4912C7.73632 12.4912 7.73688 12.4912 7.73797 12.4913C7.73901 12.4915 7.74008 12.4917 7.74107 12.4921C7.74295 12.4927 7.74396 12.4935 7.74445 12.4939C7.74494 12.4943 7.74581 12.4952 7.7467 12.497C7.74718 12.498 7.74758 12.499 7.74786 12.5C7.74815 12.5011 7.74818 12.5016 7.74817 12.5014L6.25183 12.6062ZM7.782 13.9898H17.217V12.4898H7.782V13.9898ZM17.1285 13.9846C17.6798 14.0501 18.2196 13.7924 18.5153 13.3225L17.2457 12.5236C17.2585 12.5034 17.2818 12.4922 17.3055 12.4951L17.1285 13.9846ZM18.5153 13.3225C18.811 12.8526 18.8098 12.2545 18.5121 11.7858L17.2459 12.5899C17.233 12.5697 17.233 12.5439 17.2457 12.5236L18.5153 13.3225ZM18.4885 11.7508L16.5525 9.05079L15.3335 9.92486L17.2695 12.6249L18.4885 11.7508ZM16.5467 9.04282C16.5816 9.09009 16.5816 9.15455 16.5467 9.20183L15.3393 8.31182C14.984 8.79376 14.984 9.45088 15.3393 9.93283L16.5467 9.04282ZM16.5525 9.19386L18.4885 6.49386L17.2695 5.61979L15.3335 8.31979L16.5525 9.19386ZM18.5121 6.45887C18.8098 5.99018 18.811 5.39204 18.5153 4.92214L17.2457 5.72104C17.233 5.70078 17.233 5.67499 17.2459 5.65478L18.5121 6.45887ZM18.5153 4.92214C18.2196 4.45224 17.6798 4.19454 17.1285 4.26007L17.3055 5.74958C17.2818 5.75241 17.2585 5.7413 17.2457 5.72104L18.5153 4.92214ZM17.217 4.25482H7.782V5.75482H17.217V4.25482ZM7.82747 4.2562C7.01201 4.20667 6.30892 4.82344 6.25183 5.63841L7.74817 5.74323C7.74818 5.74303 7.74815 5.74359 7.74786 5.74465C7.74758 5.74566 7.74718 5.74669 7.7467 5.74762C7.74581 5.7494 7.74494 5.7503 7.74445 5.75073C7.74396 5.75116 7.74295 5.75191 7.74107 5.75257C7.74008 5.75291 7.73901 5.75317 7.73797 5.75332C7.73688 5.75347 7.73632 5.75343 7.73653 5.75344L7.82747 4.2562ZM6.25 5.69082V12.5538H7.75V5.69082H6.25ZM6.25 12.5538V16.2987H7.75V12.5538H6.25ZM6.25 16.2987V19.0048H7.75V16.2987H6.25Z" fill="currentColor"></path> </g></svg>
                <span class="tab-text">Checkpoint</span>
            `;
            
            this.tabsContainer.appendChild(this.checkpointTab);
        }
        this.checkpointTab.style.display = 'inline-flex';
    }
}