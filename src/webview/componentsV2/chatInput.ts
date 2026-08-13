import { WebviewApi } from "../frontend";
import { PROVIDER_ICONS } from "../providerIcons";
import { ChatContainer } from "./chatContainer";
import { ChatSettings } from "./chatSettings";
import { CustomDropdown } from "./customDropdown";

export class ChatInput {

    private actionBtn: HTMLButtonElement;
    private promptInput: HTMLTextAreaElement;
    private effortContainer: HTMLElement | null;
    private effortDivider: HTMLElement | null;

    private currentChatProvider: string = '';
    private currentChatModel: string = '';

    private providerDropdown: CustomDropdown;
    private modelDropdown: CustomDropdown;
    private effortDropdown: CustomDropdown;

    private isGenerating: boolean = false;
    private sendIcon = `<svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor"><path d="M8 1L1 8h5v7h4V8h5L8 1z" /></svg>`;
    private stopIcon = `<svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor"><rect x="2" y="2" width="12" height="12" rx="2" /></svg>`;

    private approvalContainer: HTMLElement;
    private approvalCommandText: HTMLElement;
    private approveBtn: HTMLButtonElement;
    private saveApproveBtn: HTMLButtonElement;
    private denyBtn: HTMLButtonElement;
    private currentApprovalRequestId: string | null = null;

    constructor(private vscodeAPI: WebviewApi, private chatContainer: ChatContainer, private chatSettings: ChatSettings) {
        this.actionBtn = document.getElementById('actionBtn') as HTMLButtonElement;
        this.promptInput = document.getElementById('prompt') as HTMLTextAreaElement;
        this.effortContainer = document.getElementById('effortDropdown');
        this.effortDivider = document.getElementById('effortDivider');

        this.approvalContainer = document.getElementById('commandApprovalContainer') as HTMLElement;
        this.approvalCommandText = document.getElementById('approvalCommandText') as HTMLElement;
        this.approveBtn = document.getElementById('approveCommandBtn') as HTMLButtonElement;
        this.saveApproveBtn = document.getElementById('saveApproveCommandBtn') as HTMLButtonElement;
        this.denyBtn = document.getElementById('denyCommandBtn') as HTMLButtonElement;

        this.providerDropdown = new CustomDropdown('providerDropdown', 'Providers', (val: string) => {
            this.vscodeAPI.postMessage({ type: 'saveChatProvider', provider: val });
        });

        this.modelDropdown = new CustomDropdown('modelDropdown', 'Models', (val: string) => {
            if (this.currentChatProvider) {
                this.vscodeAPI.postMessage({ type: 'saveChatModel', provider: this.currentChatProvider, model: val});
            }
        });

        this.effortDropdown = new CustomDropdown('effortDropdown', 'Effort', (val: string) => {
            if (this.currentChatModel && this.currentChatProvider) {
                this.vscodeAPI.postMessage({
                    type: 'saveChatEffort',
                    provider: this.currentChatProvider,
                    model: this.currentChatModel,
                    effort: val
                });
            }
        });

        this.initListeners();

    }

    private initListeners(): void {
        this.promptInput.disabled = true;

        // User typed into the prompt box
        this.promptInput.addEventListener('input', () => {

            // Adjust box height based on lines
            this.promptInput.style.height = '20px';
            this.promptInput.style.height = this.promptInput.scrollHeight + 'px';

            // Enabled the send button if we have a provider, model and some text
            const isModelDropdownDisabled = this.modelDropdown.trigger?.disabled ?? false;
            this.actionBtn.disabled = this.promptInput.value.trim() === '' || isModelDropdownDisabled;
        });

        // Allow user to press enter key to send prompt
        // Use shift + enter to add new line
        this.promptInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!this.actionBtn.disabled) this.actionBtn.click();
            }
        });

        // User sends prompt or user cancels reponse
        this.actionBtn.addEventListener('click', () => {

            if (this.isGenerating) {
                this.vscodeAPI.postMessage({ type: 'cancelGeneration' });
                return;
            }

            const text = this.promptInput.value;
            const effort = this.effortDropdown.value? this.effortDropdown.value.toLowerCase() : undefined;

            if (text && this.currentChatProvider && this.currentChatModel) {
                this.chatContainer.addMessage({ type: 'message', role: 'user', content: text });

                this.vscodeAPI.postMessage({
                    type: 'askAgent',
                    provider: this.currentChatProvider,
                    model: this.currentChatModel,
                    effort: effort,
                    value: text
                });

                // Reset prompt
                this.promptInput.value = '';
                this.promptInput.style.height = '20px';
                this.setStopState();
            }
        });

this.approveBtn.addEventListener('click', () => this.resolveCommandApproval(true, false));
        this.saveApproveBtn.addEventListener('click', () => this.resolveCommandApproval(true, true));
        this.denyBtn.addEventListener('click', () => this.resolveCommandApproval(false, false));
    }

    // If we have sent a prompt and is waiting for the model to finish generating
    // Change the action button into a stop button that interupts the response
    public setStopState(): void {
        this.isGenerating = true;
        this.actionBtn.innerHTML = this.stopIcon;
        this.actionBtn.disabled = false;

        // Disable UI inputs
        this.promptInput.disabled = true;
        this.providerDropdown.setDisabled(true);
        this.modelDropdown.setDisabled(true);
        this.effortDropdown.setDisabled(true);
        this.chatSettings.setDisabled(true);
    }

    // Default state where there is no ongoing response
    // Change the action button into a send button
    public setSendState(): void {
        this.isGenerating = false;
        this.actionBtn.innerHTML = this.sendIcon;
        this.actionBtn.disabled = this.promptInput.value.trim() === '';

        // Only re-enable the prompt and button if a model is currently selected
        this.promptInput.disabled = !this.currentChatModel;
        this.actionBtn.disabled = this.promptInput.value.trim() === '' || this.promptInput.disabled;

        // Re-enable Dropdowns
        this.providerDropdown.setDisabled(false);
        if (this.currentChatProvider) this.modelDropdown.setDisabled(false);
        
        
        // Only re-enable effort if it is actively being shown for this model
        if (this.effortContainer && !this.effortContainer.classList.contains('hidden')) this.effortDropdown.setDisabled(false);

        // Re-enable settings menu
        this.chatSettings.setDisabled(false);
    }

    public waitForChatAPIKey(provider: string): void {
        this.promptInput.placeholder = `Waiting for ${provider} API key...`;
    }

    // Load a list of providers into the dropdown
    public populateChatProviders(providers: string[]): void {
        if (providers) this.providerDropdown.setOptions(providers);
    }

    // Load a list of provider's models into the dropdown
    public populateChatModels(models?: string[]): void {
        if (models) this.modelDropdown.setOptions(models);
    }

    // There is an inital delay when fetching models from provider
    // Don't let the user operate the elements during the loading phase
    public setChatModelsLoading(): void {
        this.actionBtn.disabled = true;
        this.currentChatModel = '';

        this.modelDropdown.setOptions([]);

        this.modelDropdown.textSpan.textContent = 'Loading...';
        this.modelDropdown.setDisabled(true);

        this.promptInput.placeholder = `Loading ${this.currentChatProvider} models...`;
        this.promptInput.disabled = true;

        // Hide the effort dropdown on new model, it needs to be refreshed
        this.clearEffortSelect();
    }

    // If the user selects a new provider, move to model loading phase
    public updateChatProvider(provider: string): void {
        if (!provider || provider === this.currentChatProvider) return;

        this.providerDropdown.selectValue(provider, false);
        this.currentChatProvider = provider;

        this.setChatModelsLoading();

        this.sendIcon = PROVIDER_ICONS[provider.toLocaleLowerCase()] || PROVIDER_ICONS['default'];
        this.actionBtn.innerHTML = this.sendIcon;

        this.vscodeAPI.postMessage({ type: 'fetchChatModels', provider: provider });
    }

    // If user selects a new model, get model details
    public updateChatModel(model: string): void {
        if (model) {
            if (model === this.currentChatModel) return;
            
            // Update dropdown selection
            this.modelDropdown.selectValue(model, false);
            this.currentChatModel = model;
            
            this.promptInput.disabled = false;
            this.promptInput.placeholder = `Prompt ${model}...`;
            
            this.vscodeAPI.postMessage({ type: 'fetchChatModelInfo', model: model });
        } 
        // If called with no model, fallback to placeholder value for model dropdown
        else {
            this.currentChatModel = '';
            this.promptInput.disabled = true;
            this.promptInput.placeholder = 'Select model...';
            this.modelDropdown.textSpan.textContent = this.modelDropdown.placeholder || 'Models';
        }

        this.modelDropdown.setDisabled(false);
        this.actionBtn.disabled = this.promptInput.value.trim() === '' || this.promptInput.disabled;
    }

    // Get model information
    public updateChatModelInfo(msg: { reason?: boolean, efforts?: string[], defaultEffort?: string}): void {

        // The current model has reasoning capabilities and effort levels
        if (msg.reason && msg.efforts && msg.efforts.length > 0) {
            const formattedEfforts = msg.efforts.map(e => e.charAt(0).toUpperCase() + e.slice(1));
            let defaultEffort = '';
            if (msg.defaultEffort) defaultEffort = msg.defaultEffort.charAt(0).toUpperCase() + msg.defaultEffort.slice(1);
            

            this.effortDropdown.setOptions(formattedEfforts, defaultEffort);
            this.effortDropdown.setDisabled(false);
            
            // Unhide the effort level dropdown
            if (this.effortContainer) this.effortContainer.classList.remove('hidden');
            if (this.effortDivider) this.effortDivider.classList.remove('hidden');
        } else {
            // If model has no reasoning capabilities or no effort levels hide the effort dropdown
            this.clearEffortSelect();
        }
    }
    
    // Hide and clear effort dropdown
    private clearEffortSelect() {
        this.effortDropdown.setOptions([]);
        this.effortDropdown.setDisabled(true);
        this.effortDropdown.textSpan.textContent = '';

        if (this.effortContainer) this.effortContainer.classList.add('hidden');
        if (this.effortDivider) this.effortDivider.classList.add('hidden');
    }

    public showCommandApproval(requestId: string, bin: string, args: string): void {
        this.currentApprovalRequestId = requestId;
        this.approvalCommandText.textContent = `${bin} ${args}`;

        // Hide prompt input
        this.promptInput.classList.add('hidden');
        this.actionBtn.classList.add('hidden');

        // Show approval UI
        this.approvalContainer.classList.remove('hidden');

        // Add a warning glow to the parent unified-box
        const unifiedBox = this.promptInput.closest('.unified-box');
        if (unifiedBox) unifiedBox.classList.add('warning-glow');
    }

    private resolveCommandApproval(approved: boolean, save: boolean): void {
        if (!this.currentApprovalRequestId) return;

        this.vscodeAPI.postMessage({
            type: 'commandApprovalResponse',
            requestId: this.currentApprovalRequestId,
            approved: approved,
            save: save
        });

        this.currentApprovalRequestId = null;

        // Restore the prompt input
        this.approvalContainer.classList.add('hidden');
        this.promptInput.classList.remove('hidden');
        this.actionBtn.classList.remove('hidden');

        const unifiedBox = this.promptInput.closest('.unified-box');
        if (unifiedBox) unifiedBox.classList.remove('warning-glow');
    }
}