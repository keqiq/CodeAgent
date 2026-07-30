import { WebviewApi } from "../frontend";

export class ChatSettings {
    
    public currentProvider: string = '';

    private container: HTMLElement;
    private toggleBtn: HTMLButtonElement;
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

    private toggleWebSearch: HTMLElement;
    private toggleWebSearchMode: HTMLElement;
    private webSearchModeLabel: HTMLElement;
    private currentWebSearchMode: 'tavily' | 'server' = 'tavily';

    private tavilyKeyBtn: HTMLElement;
    private tavilyKeyContainer: HTMLElement;
    private tavilyKeyInput: HTMLInputElement;
    private tavilyKeySaveBtn: HTMLElement;


    constructor(private vscodeAPI: WebviewApi) {
        this.container = document.getElementById('chatSettingsContainer') as HTMLElement;
        this.toggleBtn = document.getElementById('chatSettingsToggleBtn') as HTMLButtonElement;
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

        this.toggleWebSearch = document.getElementById('menuWebSearchToggle') as HTMLElement;
        this.toggleWebSearchMode = document.getElementById('menuWebSearchModeToggle') as HTMLElement;
        this.webSearchModeLabel = document.getElementById('webSearchModeLabel') as HTMLElement;

        this.tavilyKeyBtn = document.getElementById('menuTavilyKeyBtn') as HTMLElement;
        this.tavilyKeyContainer = document.getElementById('tavilyKeyContainer') as HTMLElement;
        this.tavilyKeyInput = document.getElementById('tavilyKeyInput') as HTMLInputElement;
        this.tavilyKeySaveBtn = document.getElementById('tavilyKeySaveBtn') as HTMLElement;

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
                this.clearChatConfirmBtn.classList.add('hidden');
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

        this.toggleWebSearch.addEventListener('click', () => {
            const isActive = this.toggleWebSearch.classList.toggle('active');
            
            if (isActive) {
                this.toggleWebSearchMode.classList.remove('hidden');
                if (this.currentWebSearchMode === 'tavily') this.tavilyKeyBtn.classList.remove('hidden');
            } else {
                this.toggleWebSearchMode.classList.add('hidden');
                this.tavilyKeyBtn.classList.add('hidden');
                this.tavilyKeyContainer.classList.add('hidden');
            }
            this.notifyWebSearchChange();
        });

        this.toggleWebSearchMode.addEventListener('click', () => {
            // Prevent switching to Server if the provider doesn't support it
            if (this.toggleWebSearchMode.classList.contains('disabled')) return;

            this.currentWebSearchMode = this.currentWebSearchMode === 'tavily' ? 'server' : 'tavily';
            this.updateWebSearchModeUI();
        });

        this.tavilyKeyBtn.addEventListener('click', () => {
            const isHidden = this.tavilyKeyContainer.classList.toggle('hidden');
            if (!isHidden) this.tavilyKeyInput.focus();
        });

        this.tavilyKeySaveBtn.addEventListener('click', () => {
            const key = this.tavilyKeyInput.value.trim();
            if (key) {
                this.tavilyKeyContainer.classList.add('hidden');
                this.tavilyKeyInput.value = '';
                this.vscodeAPI.postMessage({ type: 'saveTavilyAPIKey', key: key });
            }
        });
    }

    // When setting a new provider we need to update state management capabilities
    public setProvider(msg: { provider: string, stateful: boolean, serverSearch?: boolean }): void {
        if (!msg.provider) return;

        this.currentProvider = msg.provider;
        
        if (msg.provider.toLowerCase() === 'ollama') {
            this.keyBtn.classList.add('disabled');
            this.keyBtn.innerHTML = `No Key Required (Local)`;
            this.keyContainer.classList.add('hidden');
        }
        else {
            this.keyBtn.classList.remove('disabled');
            this.keyBtn.innerHTML = `Set ${msg.provider} API Key`;
        }

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

        if (!msg.serverSearch) {
            this.toggleWebSearchMode.classList.add('disabled');
            this.toggleWebSearchMode.style.opacity = '1';
            if (this.currentWebSearchMode === 'server') {
                this.currentWebSearchMode = 'tavily';
                this.updateWebSearchModeUI();
            }
        } else {
            this.toggleWebSearchMode.classList.remove('disabled');
            this.toggleWebSearchMode.style.opacity = '1';
        }
    }

    public restoreSettings(msg: {
        showAll?: boolean, 
        stateful?: boolean, 
        turnLimit?: number
        webSearch?: boolean,
        searchMode?: 'tavily' | 'server'
    }): void {
        if (msg.showAll !== undefined) {
            if (msg.showAll) this.toggleAllModels.classList.add('active');
            else this.toggleAllModels.classList.remove('active');
        }

        if (msg.stateful !== undefined) {
            if (msg.stateful) this.toggleStateful.classList.add('active');
            else this.toggleStateful.classList.remove('active');
        }

        if (msg.turnLimit !== undefined) {
            this.maxTurnInput.value = msg.turnLimit.toString();
        }

        if (msg.webSearch !== undefined) {
            if (msg.webSearch) {
                this.toggleWebSearch.classList.add('active');
                this.toggleWebSearchMode.classList.remove('hidden');
                if (msg.searchMode !== undefined) this.currentWebSearchMode = msg.searchMode;
            }
            
            else {
                this.toggleWebSearch.classList.remove('active');
                this.toggleWebSearchMode.classList.add('hidden');
                this.tavilyKeyBtn.classList.add('hidden');
                this.tavilyKeyContainer.classList.add('hidden');
            }
            this.updateWebSearchModeUI();
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

    public toggleClearChatBtn(hasMessages: boolean): void {
        if (hasMessages) this.clearChatBtn.classList.remove('disabled');
        else {
            this.clearChatBtn.classList.add('disabled');
            this.clearChatConfirmBtn.classList.add('hidden');
        }
    }

    public setDisabled(disabled: boolean): void {
        this.toggleBtn.disabled = disabled;

        if (disabled) {
            this.dropdown.classList.add('hidden');
            this.keyContainer.classList.add('hidden');
            this.clearChatConfirmBtn.classList.add('hidden');
        }
    }

    private updateWebSearchModeUI() {
        if (this.currentWebSearchMode === 'server') {
            this.webSearchModeLabel.textContent = 'SERVER';
            this.tavilyKeyBtn.classList.add('hidden');
            this.tavilyKeyContainer.classList.add('hidden');
        } else {
            this.webSearchModeLabel.textContent = 'TAVILY';
            // Only show the key button if the parent Web Search toggle is ON
            if (this.toggleWebSearch.classList.contains('active')) {
                this.tavilyKeyBtn.classList.remove('hidden');
            }
        }
        this.notifyWebSearchChange();
    }

    private notifyWebSearchChange() {
        const isEnabled = this.toggleWebSearch.classList.contains('active');
        this.vscodeAPI.postMessage({ type: 'setWebSearchMode', enabled: isEnabled, mode: this.currentWebSearchMode });
    }

    public showTavilyAPIKeyInput(): void {
        this.dropdown.classList.remove('hidden');
        this.tavilyKeyContainer.classList.remove('hidden');
        this.tavilyKeyInput.value = '';
        this.tavilyKeyInput.focus();
    }
}