import { WebviewApi } from "../frontend";

export class ChatSettings {
    
    public currentProvider: string = '';

    private container: HTMLElement;
    private toggleBtn: HTMLElement;
    private dropdown: HTMLElement;

    private toggleAllModels: HTMLElement;
    private allModelsDesc: HTMLElement;
    private toggleStateful: HTMLElement;
    private statefulDesc: HTMLElement;
    private keyBtn: HTMLElement;

    private keyContainer: HTMLElement;
    private keyInput: HTMLInputElement;
    private keySaveBtn: HTMLElement;

    private maxTurnInput: HTMLInputElement;
    private maxTurnMinus: HTMLElement;
    private maxTurnPlus: HTMLElement;

    private clearChatBtn: HTMLElement;
    private clearChatConfirmBtn: HTMLElement;

    constructor(private vscodeAPI: WebviewApi) {
        this.container = document.getElementById('chatSettingsContainer') as HTMLElement;
        this.toggleBtn = document.getElementById('chatSettingsToggleBtn') as HTMLElement;
        this.dropdown = document.getElementById('chatSettingsDropdown') as HTMLElement;

        this.toggleAllModels = document.getElementById('menuAllModelsToggle') as HTMLElement;
        this.allModelsDesc = this.toggleAllModels.querySelector('.menu-item-desc')!;
        this.toggleStateful = document.getElementById('menuStatefulToggle') as HTMLElement;
        this.statefulDesc = this.toggleStateful.querySelector('.menu-item-desc')!;
        this.keyBtn = document.getElementById('menuChatKeyBtn') as HTMLElement;

        this.keyContainer = document.getElementById('chatKeyContainer') as HTMLElement;
        this.keyInput = document.getElementById('chatKeyInput') as HTMLInputElement;
        this.keySaveBtn = document.getElementById('chatKeySaveBtn') as HTMLElement;

        this.maxTurnInput = document.getElementById('maxTurnsInput') as HTMLInputElement;
        this.maxTurnMinus = document.getElementById('maxTurnsMinus') as HTMLElement;
        this.maxTurnPlus = document.getElementById('maxTurnsPlus') as HTMLElement;

        this.clearChatBtn = document.getElementById('menuClearChatBtn') as HTMLElement;
        this.clearChatConfirmBtn = document.getElementById('clearChatConfirmBtn') as HTMLElement;

        this.initListeners();
    }

    private initListeners() {
        // Toggle settings menu
        this.toggleBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.dropdown.classList.toggle('hidden');
            this.keyContainer.classList.add('hidden');
        });

        // Close menu when clicking off
        document.addEventListener('click', (e: MouseEvent) => {
            if (e.target instanceof Node && !this.container.contains(e.target)) {
                this.dropdown.classList.add('hidden');
            }
        });

        // Toggles between my curated list of models per provider or all chat models from provider
        this.toggleAllModels.addEventListener('click', () => {
            if (this.toggleAllModels.classList.contains('disabled')) return;
            const isActive = this.toggleAllModels.classList.toggle('active');
            this.vscodeAPI.postMessage({ type: 'setShowAllModels', showAll: isActive });
        });

        // Toggles between provider server side state management
        // Supported by OpenAI's responses API and Gemini's interactions API afaik
        this.toggleStateful.addEventListener('click', () => {
            if (this.toggleStateful.classList.contains('disabled')) return;
            const isActive = this.toggleStateful.classList.toggle('active');
            this.vscodeAPI.postMessage({ type: 'setStateManagement', stateful: isActive });
        });

        // Toggle chat API key input
        this.keyBtn.addEventListener('click', () => {
            if (this.keyBtn.classList.contains('disabled')) return;
            const isHidden = this.keyContainer.classList.toggle('hidden');
            if (!isHidden) this.keyInput.focus();
        });

        this.keySaveBtn.addEventListener('click', () => {
            const key = this.keyInput.value.trim();
            if (key && this.currentProvider) {
                // Reset menu key state
                this.dropdown.classList.add('hidden');
                this.keyContainer.classList.add('hidden');
                this.keyInput.value = '';

                this.vscodeAPI.postMessage({ type: 'saveChatAPIKey', provider: this.currentProvider, key: key });
            }
        });

        // Max turn input, decrement and increment listeners
        this.maxTurnMinus.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            const val = parseInt(this.maxTurnInput.value, 10) || 0;
            this.maxTurnInput.value = (val - 1).toString();
            this.notifyMaxTurnChange();
        });

        this.maxTurnPlus.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            const val = parseInt(this.maxTurnInput.value, 10) || 0;
            this.maxTurnInput.value = (val + 1).toString();
            this.notifyMaxTurnChange();
        });

        this.maxTurnInput .addEventListener('change', () => {
            const val = parseInt(this.maxTurnInput.value, 10);
            if (isNaN(val) || val < 0) this.maxTurnInput.value = '0';
            this.notifyMaxTurnChange();
        });

        this.maxTurnInput.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
        });

        this.clearChatBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.clearChatConfirmBtn.classList.remove('hidden');
        });

        this.clearChatConfirmBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.vscodeAPI.postMessage({ type: 'clearChat' });

            this.clearChatConfirmBtn.classList.add('hidden');
            this.dropdown.classList.add('hidden');
        });
    }

    // When setting a new provider we need to update state management capabilities
    public setProvider(msg: { provider: string, stateful: boolean }): void {
        if (!msg.provider) return;

        this.currentProvider = msg.provider;
        this.keyBtn.classList.remove('disabled');
        this.keyBtn.innerHTML = `Set ${msg.provider} API Key`;
        
        if (!msg.stateful) {
            this.toggleStateful.classList.remove('active');
            this.toggleStateful.classList.add('disabled');
            this.statefulDesc.textContent = `Not supported by ${msg.provider}.`;
            this.toggleStateful.style.opacity = '0.5';
        }

        else {
            this.toggleStateful.classList.remove('disabled');
            this.statefulDesc.textContent = "Server-side context management.";
            this.toggleStateful.style.opacity = '';
        }
    }

    public restoreSettings(msg: {showALl?: boolean, stateful?: boolean, turnLimit?: number}): void {
        if (msg.showALl !== undefined) {
            if (msg.showALl) this.toggleAllModels.classList.add('active');
            else this.toggleAllModels.classList.remove('active');
        }

        if (msg.stateful !== undefined) {
            if (msg.stateful) this.toggleStateful.classList.add('active');
            else this.toggleStateful.classList.remove('active');
        }

        if (msg.turnLimit !== undefined) {
            this.maxTurnInput.value = msg.turnLimit.toString();
        }
    }

    public showChatAPIKeyInput(provider: string): void {

        this.dropdown.classList.remove('hidden');
        this.keyContainer.classList.remove('hidden');

        this.keyInput.value = '';
        this.keyInput.placeholder = `Enter ${provider} API Key...`;
        this.keyInput.focus();
    }

    private notifyMaxTurnChange(): void {
        this.vscodeAPI.postMessage({ type: 'updateTurnLimit', limit: parseInt(this.maxTurnInput.value, 10) || 0 });
    }
}