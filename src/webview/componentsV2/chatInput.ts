import { WebviewApi } from "../frontend";
import { ChatContainer } from "./chatContainer";
import { CustomDropdown } from "./customDropdown";

export class ChatInput {

    private sendBtn: HTMLButtonElement;
    private promptInput: HTMLTextAreaElement;
    private effortContainer: HTMLElement | null;
    private effortDivider: HTMLElement | null;

    private currentChatProvider: string = '';
    private currentChatModel: string = '';

    private providerDropdown: CustomDropdown;
    private modelDropdown: CustomDropdown;
    private effortDropdown: CustomDropdown;


    constructor(private vscodeAPI: WebviewApi, private chatContainer: ChatContainer) {
        this.sendBtn = document.getElementById('sendBtn') as HTMLButtonElement;
        this.promptInput = document.getElementById('prompt') as HTMLTextAreaElement;
        this.effortContainer = document.getElementById('effortDropdown');
        this.effortDivider = document.getElementById('effortDivider');

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
            this.sendBtn.disabled = this.promptInput.value.trim() === '' || isModelDropdownDisabled;
        });

        // Allow user to press enter key to send prompt
        // Use shift + enter to add new line
        this.promptInput.addEventListener('keydown', (e: KeyboardEvent) => {
            if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (!this.sendBtn.disabled) this.sendBtn.click();
            }
        });


        // User sends prompt
        this.sendBtn.addEventListener('click', () => {
            const text = this.promptInput.value;

            const effort = this.effortDropdown.value? this.effortDropdown.value.toLowerCase() : undefined;

            if (text && this.currentChatProvider && this.currentChatModel) {
                this.chatContainer.appendMessage({ type: 'message', role: 'user', content: text });
                this.chatContainer.showTypingIndicator();

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
                this.sendBtn.disabled = true;
            }
        });
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
        this.sendBtn.disabled = true;
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
            this.promptInput.placeholder = `Ask ${model}...`;
            
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
        this.sendBtn.disabled = this.promptInput.value.trim() === '' || this.promptInput.disabled;
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
}