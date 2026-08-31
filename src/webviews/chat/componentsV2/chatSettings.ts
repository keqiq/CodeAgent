import { WebviewApi } from "../../Webview";

export class ChatSettings {
    
    public currentProvider: string = '';
    private currentOllamaPort: number = 11434;

    private container: HTMLElement;
    private toggleBtn: HTMLButtonElement;
    private dropdown: HTMLElement;

    private toggleAllModels: HTMLElement;
    private toggleStateful: HTMLElement;
    private statefulDesc: HTMLElement;
    private keyBtn: HTMLElement;

    private keyContainer: HTMLElement;
    private keyInput: HTMLInputElement;
    private keySaveBtn: HTMLElement;

    private maxTurnInput: HTMLInputElement;
    private maxTurnMinus: HTMLElement;
    private maxTurnPlus: HTMLElement;

    private timeoutInput: HTMLInputElement;
    private timeoutMinus: HTMLElement;
    private timeoutPlus: HTMLElement;

    private toggleWebSearch: HTMLElement;
    private toggleWebSearchMode: HTMLElement;
    private webSearchModeLabel: HTMLElement;
    private currentWebSearchMode: 'tavily' | 'server' = 'tavily';

    private tavilyKeyBtn: HTMLElement;
    private tavilyKeyContainer: HTMLElement;
    private tavilyKeyInput: HTMLInputElement;
    private tavilyKeySaveBtn: HTMLElement;
    private isTavilyKeyValid: boolean = true;

    constructor(rootElement: HTMLElement, private vscodeAPI: WebviewApi) {
        this.container = rootElement.querySelector('.chat-settings-container') as HTMLElement;
        this.toggleBtn = rootElement.querySelector('.chat-settings-toggle-btn') as HTMLButtonElement;
        this.dropdown = rootElement.querySelector('.chat-settings-dropdown') as HTMLElement;

        this.toggleAllModels = rootElement.querySelector('.menu-all-models-toggle') as HTMLElement;
        this.toggleStateful = rootElement.querySelector('.menu-stateful-toggle') as HTMLElement;
        this.statefulDesc = this.toggleStateful.querySelector('.menu-item-desc')!;
        this.keyBtn = rootElement.querySelector('.menu-chat-key-btn') as HTMLElement;

        this.keyContainer = rootElement.querySelector('.chat-key-container') as HTMLElement;
        this.keyInput = rootElement.querySelector('.chat-key-input') as HTMLInputElement;
        this.keySaveBtn = rootElement.querySelector('.chat-key-save-btn') as HTMLElement;

        this.maxTurnInput = rootElement.querySelector('.max-turns-input') as HTMLInputElement;
        this.maxTurnMinus = rootElement.querySelector('.max-turns-minus') as HTMLElement;
        this.maxTurnPlus = rootElement.querySelector('.max-turns-plus') as HTMLElement;

        this.timeoutInput = rootElement.querySelector('.timeout-input') as HTMLInputElement;
        this.timeoutMinus = rootElement.querySelector('.timeout-minus') as HTMLElement;
        this.timeoutPlus = rootElement.querySelector('.timeout-plus') as HTMLElement;

        this.toggleWebSearch = rootElement.querySelector('.menu-web-search-toggle') as HTMLElement;
        this.toggleWebSearchMode = rootElement.querySelector('.menu-web-search-mode-toggle') as HTMLElement;
        this.webSearchModeLabel = rootElement.querySelector('.web-search-mode-label') as HTMLElement;

        this.tavilyKeyBtn = rootElement.querySelector('.menu-tavily-key-btn') as HTMLElement;
        this.tavilyKeyContainer = rootElement.querySelector('.tavily-key-container') as HTMLElement;
        this.tavilyKeyInput = rootElement.querySelector('.tavily-key-input') as HTMLInputElement;
        this.tavilyKeySaveBtn = rootElement.querySelector('.tavily-key-save-btn') as HTMLElement;

        this.initListeners();
    }

    private initListeners() {
        // Toggle settings menu
        this.toggleBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            const willOpen = this.dropdown.classList.contains('hidden');

            // Notify all other menus to close
            document.dispatchEvent(new CustomEvent('closeAllMenus', { detail: { source: this } }));

            if (willOpen) {
                this.dropdown.classList.remove('hidden');
                this.keyContainer.classList.add('hidden');
                this.tavilyKeyContainer.classList.add('hidden');
            } else {
                this.close();
            }
        });

        // Close when another menu opens
        document.addEventListener('closeAllMenus', (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail?.source !== this) {
                this.close();
            }
        });

        // Close menu when clicking off
        document.addEventListener('click', (e: MouseEvent) => {
            if (e.target instanceof Node && !this.container.contains(e.target)) {
                this.close();
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

        // Toggle chat API key / Ollama Port input
        this.keyBtn.addEventListener('click', () => {
            if (this.keyBtn.classList.contains('disabled')) return;
            const isHidden = this.keyContainer.classList.toggle('hidden');
            
            if (!isHidden) {
                if (this.currentProvider.toLowerCase() === 'ollama') {
                    this.keyInput.type = 'number';
                    this.keyInput.placeholder = 'e.g. 11434';
                    this.keyInput.value = this.currentOllamaPort.toString();
                } else {
                    this.keyInput.type = 'password';
                    this.keyInput.placeholder = `Enter ${this.currentProvider} API Key...`;
                    this.keyInput.value = '';
                }
                this.keyInput.focus();
            }
        });

        this.keySaveBtn.addEventListener('click', () => {
            const val = this.keyInput.value.trim();
            if (val && this.currentProvider) {
                this.dropdown.classList.add('hidden');
                this.keyContainer.classList.add('hidden');
                this.keyInput.value = '';

                if (this.currentProvider.toLowerCase() === 'ollama') {
                    const port = parseInt(val, 10) || 11434;
                    this.currentOllamaPort = port;
                    this.vscodeAPI.postMessage({ type: 'saveOllamaChatPort', port: port });
                } else {
                    this.vscodeAPI.postMessage({ type: 'saveChatAPIKey', provider: this.currentProvider, key: val });
                }
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

        // Execution timeout listeners
        this.timeoutMinus.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            const val = parseInt(this.timeoutInput.value, 10) || 0;
            this.timeoutInput.value = Math.max(0, val - 1).toString();
            this.notifyTimeoutChange();
        });

        this.timeoutPlus.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            const val = parseInt(this.timeoutInput.value, 10) || 0;
            this.timeoutInput.value = (val + 1).toString();
            this.notifyTimeoutChange();
        });

        this.timeoutInput.addEventListener('change', () => {
            const val = parseInt(this.timeoutInput.value, 10);
            if (isNaN(val) || val < 0) this.timeoutInput.value = '0';
            this.notifyTimeoutChange();
        });

        this.timeoutInput.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
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
            this.notifyWebSearchChange();
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

                this.isTavilyKeyValid = true;
                this.updateWebSearchModeUI();

                this.vscodeAPI.postMessage({ type: 'saveTavilyAPIKey', key: key });
            }
        });
    }


    public setDisabled(disabled: boolean): void {
        this.toggleBtn.disabled = disabled;
        if (disabled) this.close();
    }

    public close(): void {
        this.dropdown.classList.add('hidden');
        this.keyContainer.classList.add('hidden');
        this.tavilyKeyContainer.classList.add('hidden');
    }

    // When setting a new provider we need to update state management capabilities
    public setProvider(msg: { provider: string, stateful: boolean, serverSearch?: boolean }): void {
        if (!msg.provider) return;

        this.currentProvider = msg.provider;
        
        this.keyBtn.classList.remove('hidden', 'disabled');
        if (msg.provider.toLowerCase() === 'ollama') {
            this.keyBtn.innerHTML = `Set Ollama Chat Port (${this.currentOllamaPort})`;
        } else {
            this.keyBtn.innerHTML = `Set ${msg.provider} API Key`;
        }
        if (!msg.stateful) {
            this.toggleStateful.classList.add('disabled');
            this.statefulDesc.textContent = `Not supported by ${msg.provider}.`;
        }

        else {
            this.toggleStateful.classList.remove('disabled');
            this.statefulDesc.textContent = "Server-side context management.";
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
        turnLimit?: number,
        executionTimeout?: number;
        webSearch?: boolean,
        searchMode?: 'tavily' | 'server',
        ollamaPort?: number
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

        if (msg.executionTimeout !== undefined) {
            this.timeoutInput.value = msg.executionTimeout.toString();
        }

        if (msg.webSearch !== undefined) {
            if (msg.webSearch) {
                this.toggleWebSearch.classList.add('active');
                this.toggleWebSearchMode.classList.remove('hidden');
                if (msg.searchMode !== undefined) this.currentWebSearchMode = msg.searchMode;
                // check the tavily key on restore
                if (msg.searchMode === 'tavily') this.notifyWebSearchChange();
            }
            
            else {
                this.toggleWebSearch.classList.remove('active');
                this.toggleWebSearchMode.classList.add('hidden');
                this.tavilyKeyBtn.classList.add('hidden');
                this.tavilyKeyContainer.classList.add('hidden');
            }
            this.updateWebSearchModeUI();
        }

        if (msg.ollamaPort !== undefined) {
            this.currentOllamaPort = msg.ollamaPort;
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

    private notifyTimeoutChange(): void {
        this.vscodeAPI.postMessage({ type: 'updateExecutionTimeout', timeout: parseInt(this.timeoutInput.value, 10) || 0 });
    }

    private updateWebSearchModeUI() {
        if (this.currentWebSearchMode === 'server') {
            this.webSearchModeLabel.textContent = 'SERVER';
            this.webSearchModeLabel.classList.remove('error');
            this.tavilyKeyBtn.classList.add('hidden');
            this.tavilyKeyContainer.classList.add('hidden');
        } else {
            this.webSearchModeLabel.textContent = 'TAVILY';

            if (!this.isTavilyKeyValid) {
                this.webSearchModeLabel.classList.add('error');
            } else {
                this.webSearchModeLabel.classList.remove('error');
            }

            // Only show the key button if the parent Web Search toggle is ON
            if (this.toggleWebSearch.classList.contains('active')) {
                this.tavilyKeyBtn.classList.remove('hidden');
            }
        }
    }

    private notifyWebSearchChange() {
        const isEnabled = this.toggleWebSearch.classList.contains('active');
        this.vscodeAPI.postMessage({ type: 'setWebSearchMode', enabled: isEnabled, mode: this.currentWebSearchMode });
    }

    public showTavilyAPIKeyInput(): void {
        this.isTavilyKeyValid = false;
        this.updateWebSearchModeUI();

        this.dropdown.classList.remove('hidden');
        this.tavilyKeyContainer.classList.remove('hidden');
        this.tavilyKeyInput.value = '';
        this.tavilyKeyInput.focus();
    }
}