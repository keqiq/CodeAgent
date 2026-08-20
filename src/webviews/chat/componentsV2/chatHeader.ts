import { WebviewApi } from "../../Webview";
import type { IndexStatusMessage } from "../../../indexing/indexer";
import { CustomDropdown } from "./customDropdown";

export class ChatHeader {
    private indexBtn: HTMLButtonElement;
    private indexStatus: HTMLSpanElement;
    private indexDot: HTMLSpanElement;
    private indexControls: HTMLElement;
    private indexSettingsBtn: HTMLButtonElement;
    private actionIndexBtn: HTMLButtonElement;
    private actionIndexBtnText: HTMLSpanElement;

    private providerDropdown: CustomDropdown;
    private modelDropdown: CustomDropdown;
    private currentEmbedProvider: string = '';
    private currentEmbedModel: string = '';
    private currentOllamaPort: number = 11434;

    private indexSettingsContainer: HTMLElement;
    private indexSettingsDropdown: HTMLElement;

    private vectorCountInput: HTMLInputElement;
    private debounceTimeInput: HTMLInputElement;

    private keyBtn: HTMLElement;
    private keyContainer: HTMLElement;
    private keyInput: HTMLInputElement;
    private keySaveBtn: HTMLElement;

    private toggleIndex: HTMLElement;
    private isIndexGloballyEnabled: boolean = true;

    private clearIndexBtn: HTMLElement;
    private clearIndexConfirmBtn: HTMLButtonElement;

    private countdownInterval?: number;

    constructor(private vscodeAPI: WebviewApi) {
        this.indexBtn = document.getElementById('indexBtn') as HTMLButtonElement;
        this.indexStatus = document.getElementById('indexStatus') as HTMLSpanElement;
        this.indexDot = document.getElementById('indexDot') as HTMLSpanElement;
        this.indexControls = document.getElementById('indexControls') as HTMLElement;
        this.indexSettingsBtn = document.getElementById('indexSettingsBtn') as HTMLButtonElement;
        this.indexSettingsContainer = document.getElementById('indexSettingsContainer') as HTMLElement;
        this.indexSettingsDropdown = document.getElementById('indexSettingsDropdown') as HTMLElement;
        this.actionIndexBtn = document.getElementById('actionIndexBtn') as HTMLButtonElement;
        this.actionIndexBtnText = document.getElementById('actionIndexBtnText') as HTMLSpanElement;
        this.vectorCountInput = document.getElementById('vectorCountInput') as HTMLInputElement;
        this.debounceTimeInput = document.getElementById('debounceTimeInput') as HTMLInputElement;
        this.keyBtn = document.getElementById('menuEmbedKeyBtn') as HTMLElement;
        this.keyContainer = document.getElementById('embedKeyContainer') as HTMLElement;
        this.keyInput = document.getElementById('embedKeyInput') as HTMLInputElement;
        this.keySaveBtn = document.getElementById('embedKeySaveBtn') as HTMLElement;
        this.toggleIndex = document.getElementById('menuIndexToggle') as HTMLElement;
        this.clearIndexBtn = document.getElementById('menuClearIndexBtn') as HTMLElement;
        this.clearIndexConfirmBtn = document.getElementById('clearIndexConfirmBtn') as HTMLButtonElement;

        this.providerDropdown = new CustomDropdown('embedProviderDropdown', 'Providers', (val: string) => {
            this.vscodeAPI.postMessage({ type: 'saveEmbedProvider', provider: val });
        });

        this.modelDropdown = new CustomDropdown('embedModelDropdown', 'Models', (val: string) => {
            this.vscodeAPI.postMessage({ type: 'saveEmbedModel', provider: this.currentEmbedProvider, model: val });
        });

        this.initListeners();
    }

    private initListeners(): void {
        // Toggle inline controls
        this.indexBtn.addEventListener('click', () => {
            this.indexControls.classList.toggle('hidden');
        });

        // Toggle settings menu
        this.indexSettingsBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            const willOpen = this.indexSettingsDropdown.classList.contains('hidden');

            // Notify all other menus to close
            document.dispatchEvent(new CustomEvent('closeAllMenus', { detail: { source: this } }));

            if (willOpen) {
                this.indexSettingsDropdown.classList.remove('hidden');
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

        // Close settings menu when clicking off
        document.addEventListener('click', (e: MouseEvent) => {
            if (e.target instanceof Node && !this.indexSettingsContainer.contains(e.target)) {
                this.close();
            }
        });

        // Inputs for vector count and debounce timer
        const setupNumberControl = (inputId: string, minusId: string, plusId: string, eventName: string, minVal: number) => {
            const input = document.getElementById(inputId) as HTMLInputElement;
            const minus = document.getElementById(minusId) as HTMLElement;
            const plus = document.getElementById(plusId) as HTMLElement;

            const updateValue = (newVal: number) => {
                const finalVal = Math.max(minVal, newVal);
                input.value = finalVal.toString();
                this.vscodeAPI.postMessage({ type: eventName, value: finalVal });
            };

            minus.addEventListener('click', (e) => { e.stopPropagation(); updateValue(parseInt(input.value) - 1); });
            plus.addEventListener('click', (e) => { e.stopPropagation(); updateValue(parseInt(input.value) + 1); });
            
            input.addEventListener('change', () => {
                const val = parseInt(input.value);
                updateValue(isNaN(val) ? minVal : val);
            });
            input.addEventListener('click', (e) => e.stopPropagation());
        };

        setupNumberControl('vectorCountInput', 'vectorCountMinus', 'vectorCountPlus', 'updateVectorCount', 1);
        setupNumberControl('debounceTimeInput', 'debounceTimeMinus', 'debounceTimePlus', 'updateDebounceTime', 0);

        // Index the workspace 
        this.actionIndexBtn.addEventListener('click', () => {
            if (this.currentEmbedProvider && this.currentEmbedModel) {
                this.vscodeAPI.postMessage({
                    type: 'indexWorkspace',
                    provider: this.currentEmbedProvider,
                    model: this.currentEmbedModel
                });
            }
        });

        // Embed API Key / Ollama Port button click
        this.keyBtn.addEventListener('click', () => {
            if (this.keyBtn.classList.contains('disabled')) return;
            const isHidden = this.keyContainer.classList.toggle('hidden');
            
            if (!isHidden) {
                if (this.currentEmbedProvider.toLowerCase() === 'ollama') {
                    this.keyInput.type = 'number';
                    this.keyInput.placeholder = 'e.g. 11434';
                    this.keyInput.value = this.currentOllamaPort.toString();
                } else {
                    this.keyInput.type = 'password';
                    this.keyInput.inputMode = 'text';
                    this.keyInput.placeholder = `Enter ${this.currentEmbedProvider} Embedding API Key...`;
                    this.keyInput.value = '';
                }
                this.keyInput.focus();
            }
        });

        // Embed API Key / Ollama Port Save
        this.keySaveBtn.addEventListener('click', () => {
            const val = this.keyInput.value.trim();
            if (val && this.currentEmbedProvider) {
                // Reset menu key state
                this.indexSettingsDropdown.classList.add('hidden');
                this.keyContainer.classList.add('hidden');
                this.keyInput.value = '';

                if (this.currentEmbedProvider.toLowerCase() === 'ollama') {
                    const port = parseInt(val, 10) || 11434;
                    this.currentOllamaPort = port;
                    this.keyBtn.innerHTML = `Set Ollama Port (${this.currentOllamaPort})`;
                    this.vscodeAPI.postMessage({ 
                        type: 'saveOllamaEmbedPort', 
                        port: port 
                    });
                } else {
                    this.vscodeAPI.postMessage({ 
                        type: 'saveEmbedAPIKey', 
                        provider: this.currentEmbedProvider, 
                        key: val 
                    });
                }
            }
        });

        // Toggle indexing
        this.toggleIndex.addEventListener('click', () => {
            const isActive = this.toggleIndex.classList.toggle('active');
            this.setGlobalIndexState(isActive);
            this.vscodeAPI.postMessage({ type: 'updateIndexEnabled', enabled: isActive });
        });

        // Delete table confirmation show
        this.clearIndexBtn.addEventListener('click', (e) => {
            if (this.clearIndexBtn.classList.contains('disabled')) return;
            e.stopPropagation();
            this.clearIndexConfirmBtn.classList.remove('hidden');
        });

        // Delete table
        this.clearIndexConfirmBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            this.clearIndexConfirmBtn.classList.add('hidden');
            this.indexSettingsDropdown.classList.add('hidden');
            
            this.vscodeAPI.postMessage({ type: 'deleteIndex' });
        });
    }

    public close(): void {
        this.indexSettingsDropdown.classList.add('hidden');
        this.keyContainer.classList.add('hidden');
        this.clearIndexConfirmBtn.classList.add('hidden');
    }

    public restoreSettings(msg: { 
        retrievalCount?: number, 
        debounceTime?: number, 
        enabled?: boolean,
        ollamaPort?: number 
    }): void {
        if (msg.retrievalCount !== undefined) {
            this.vectorCountInput.value = msg.retrievalCount.toString();
        }

        if (msg.debounceTime !== undefined) {
            this.debounceTimeInput.value = msg.debounceTime.toString();
        }

        if (msg.enabled !== undefined) {
            this.setGlobalIndexState(msg.enabled);
        }

        if (msg.ollamaPort !== undefined) {
            this.currentOllamaPort = msg.ollamaPort;
        }
    }

    public setGlobalIndexState(enabled: boolean): void {
        this.isIndexGloballyEnabled = enabled;

        if (!enabled) {
            // Lock down the UI
            this.updateStatusText('Indexing Disabled', 'disabled');
            this.providerDropdown.setDisabled(true);
            this.modelDropdown.setDisabled(true);
            
            this.actionIndexBtn.disabled = true;
            this.actionIndexBtn.classList.remove('state-indexed', 'state-indexing', 'state-error');
            this.actionIndexBtn.classList.add('state-unindexed');
            this.actionIndexBtnText.textContent = 'Index';
            this.clearIndexBtn.classList.add('disabled');
            this.clearIndexConfirmBtn.classList.add('hidden');
        } else {
            // Unlock the UI
            this.providerDropdown.setDisabled(false);
            this.modelDropdown.setDisabled(false);
            
            // Attempt to restore visual state based on what's selected
            if (this.currentEmbedModel) {
                this.updateStatusText(`Loading ${this.currentEmbedModel}...`, 'spinning');
                this.actionIndexBtn.disabled = true;
                this.actionIndexBtn.classList.remove('state-indexed', 'state-unindexed', 'state-error');
                this.actionIndexBtn.classList.add('state-indexing');
                this.actionIndexBtnText.textContent = 'Loading...';
                this.vscodeAPI.postMessage({ type: 'loadVectorDB', model: this.currentEmbedModel });
            } else if (this.currentEmbedProvider) {
                this.updateStatusText('Select Embedding Model', 'warning');
            } else {
                this.updateStatusText('Not Indexed', 'warning');
            }
        }
    }

    // Disable dropdown and action index btn
    public setEmbedModelsLoading(provider: string): void {
        this.modelDropdown.setOptions([]);
        this.modelDropdown.textSpan.textContent = 'Loading...';
        this.modelDropdown.setDisabled(true);
        this.updateStatusText(`Loading ${provider} models...`, 'warning');
        this.actionIndexBtn.disabled = true;
    }

    private updateStatusText(text: string, dotClass: 'ready' | 'warning' | 'error' | 'disabled' | 'spinning'): void {
        this.indexStatus.textContent = text;
        this.indexDot.className = `status-dot ${dotClass}`;
    }

    public populateEmbedProviders(providers: string[]): void {
        this.providerDropdown.setOptions(providers);
    }

    public populateEmbedModels(models: string[]): void {
        if (models) this.modelDropdown.setOptions(models);
    }

    public updateEmbedProviders(provider: string | undefined) {
        if (!this.isIndexGloballyEnabled) return;
        if (!provider || provider === this.currentEmbedProvider) return;
        this.providerDropdown.selectValue(provider, false);
        this.currentEmbedProvider = provider;
        this.keyBtn.classList.remove('disabled');
        
        if (provider.toLowerCase() === 'ollama') {
            this.keyBtn.innerHTML = `Set Ollama Embedding Port (${this.currentOllamaPort})`;
        } else {
            this.keyBtn.innerHTML = `Set ${provider} Embedding API Key`;
        }

        this.setEmbedModelsLoading(provider);
        this.vscodeAPI.postMessage({ type: 'fetchEmbedModels', provider: provider });
    }

    public updateEmbedModel(model: string): void {
        if (!this.isIndexGloballyEnabled) return;
        if (model) {
            if (model === this.currentEmbedModel) return;

            this.modelDropdown.selectValue(model, false);
            this.currentEmbedModel = model;
            this.updateStatusText(`Loading ${model} embedding vectors...`, 'spinning');

            this.actionIndexBtn.disabled = true;
            this.actionIndexBtn.classList.remove('state-unindexed', 'state-indexed', 'state-error');
            this.actionIndexBtn.classList.add('state-indexing');
            this.actionIndexBtnText.textContent = 'Loading...';

            this.vscodeAPI.postMessage({ type: 'loadVectorDB', model: model });
        }
        else {
            this.currentEmbedModel = '';
            this.modelDropdown.selectValue('', false);
            this.modelDropdown.setDisabled(false);
            this.modelDropdown.textSpan.textContent = 'Models';
            this.updateStatusText('Select Embedding Model', 'warning');

            this.actionIndexBtn.disabled = true;
            this.actionIndexBtnText.textContent = 'Index';
            this.actionIndexBtn.classList.remove('state-indexed', 'state-indexing', 'state-error');
            this.actionIndexBtn.classList.add('state-unindexed');
        }
        this.modelDropdown.setDisabled(false);
    }

    // Update indexing status text and index action button
    public updateIndexStatus(msg: IndexStatusMessage): void {
        if (!this.isIndexGloballyEnabled) return;
        this.actionIndexBtn.classList.remove('state-unindexed', 'state-indexed', 'state-indexing', 'state-error');

        if (this.countdownInterval) {
            window.clearInterval(this.countdownInterval);
            this.countdownInterval = undefined;
        }

        const isProcessing = msg.state === 'indexing' || msg.state === 'queued';
        this.toggleControls(isProcessing);

        switch (msg.state) {
            case 'indexed':
                this.updateStatusText(`${msg.vectorCount} Vectors Loaded`, 'ready');
                this.actionIndexBtnText.textContent = 'Reindex';
                this.actionIndexBtn.classList.add('state-indexed');
                this.clearIndexBtn.classList.remove('disabled');
                break;
                
            case 'unindexed':
                this.updateStatusText(msg.text || 'Not Indexed', 'warning');
                this.actionIndexBtnText.textContent = 'Index';
                this.actionIndexBtn.classList.add('state-unindexed');
                this.clearIndexBtn.classList.add('disabled');
                this.clearIndexConfirmBtn.classList.add('hidden');
                break;
                
            case 'error':
                this.updateStatusText(msg.text, 'error');
                this.actionIndexBtnText.textContent = 'Index';
                this.actionIndexBtn.classList.add('state-error');
                this.clearIndexBtn.classList.remove('disabled');
                break;

            case 'outdated':
                this.updateStatusText(msg.text, 'warning');
                this.actionIndexBtnText.textContent = 'Reindex';
                this.actionIndexBtn.classList.add('state-unindexed');
                this.clearIndexBtn.classList.remove('disabled');
                break;
                
            case 'indexing':
                this.updateStatusText(msg.text, 'spinning');
                this.actionIndexBtnText.textContent = 'Indexing...';
                this.actionIndexBtn.classList.add('state-indexing');
                break;

            case 'queued':
                let timeLeft = msg.delay;

                this.updateStatusText(`${msg.fileCount} queued (Reindex in ${timeLeft}s)`, 'spinning');
                this.actionIndexBtn.classList.add('state-indexed');

                this.countdownInterval = window.setInterval(() => {
                    timeLeft -= 1;
                    if (timeLeft > 0) {
                        this.updateStatusText(`${msg.fileCount} queued (Reindex in ${timeLeft}s)`, 'spinning');
                    }
                    else {
                        window.clearInterval(this.countdownInterval);
                    }
                }, 1000);
                break;
        }
    }

    // When the index state is busy ie indexing or queued, disabled all controls to not mess anything up
    private toggleControls(isProcessing: boolean): void {
        // Dropdowns and buttons
        this.providerDropdown.setDisabled(isProcessing);
        this.modelDropdown.setDisabled(isProcessing);
        this.actionIndexBtn.disabled = isProcessing;

        // Settings Menu 
        this.indexSettingsBtn.disabled = isProcessing;
        
        // Only re-enable the key button if a provider is actually selected
        if (isProcessing) {
            this.indexSettingsDropdown.classList.add('hidden');
            this.keyContainer.classList.add('hidden');
        }
    }

    // Open key input container in the settings dropdown
    public requestEmbedAPIKey(provider: string): void {
        this.currentEmbedModel = '';
        this.updateStatusText(`${provider} API key required`, 'warning');
        
        // Unhide the dropdown and the input container
        this.indexSettingsDropdown.classList.remove('hidden');
        this.keyContainer.classList.remove('hidden');

        this.keyInput.value = '';
        this.keyInput.placeholder = `Enter ${provider} API Key...`;
        this.keyInput.focus();
    }
}