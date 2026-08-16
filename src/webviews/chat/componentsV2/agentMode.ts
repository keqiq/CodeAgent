import { WebviewApi } from "../../Webview";

export class AgentMode {

    private modeToggleBtn: HTMLButtonElement;
    private agentConfigBtn: HTMLButtonElement;

    private isAutoMode: boolean = false;
    private isUnsafe: boolean = false;

    constructor(private vscodeAPI: WebviewApi) {
        this.modeToggleBtn = document.getElementById('modeToggleBtn') as HTMLButtonElement;
        this.agentConfigBtn = document.getElementById('agentConfigBtn') as HTMLButtonElement;

        this.initListeners();
    }

    private initListeners() {

        this.modeToggleBtn.addEventListener('click', () => {
            this.isAutoMode = !this.isAutoMode;
            this.updateModeUI();
            
            this.vscodeAPI.postMessage({ 
                type: 'setAgentMode', 
                mode: this.isAutoMode ? 'auto' : 'manual' 
            });
        });

        this.agentConfigBtn.addEventListener('click', () => {
            this.vscodeAPI.postMessage({ type: 'openAgentConfig' });
        });
    }

    public setAgentMode(mode: 'auto' | 'manual'): void {
        this.isAutoMode = mode === 'auto';
        this.updateModeUI();
    }

    public setUnsafe(isUnsafe: boolean): void {
        this.isUnsafe = isUnsafe;
        this.updateModeUI();
    }

    private updateModeUI(): void {
        this.modeToggleBtn.textContent = this.isAutoMode ? 'AUTO' : 'MANUAL';
        this.modeToggleBtn.classList.remove('mode-manual', 'mode-auto', 'mode-unsafe');
        this.agentConfigBtn.classList.remove('mode-auto', 'mode-unsafe');
        
        if (this.isAutoMode) {
            // Switch to auto colors & show gear
            this.agentConfigBtn.classList.remove('hidden');

            // Yellow warning to both
            if (this.isUnsafe) {
                this.modeToggleBtn.classList.add('mode-unsafe');
                this.agentConfigBtn.classList.add('mode-unsafe');
            } 
            // Green safe to both
            else {
                this.modeToggleBtn.classList.add('mode-auto');
                this.agentConfigBtn.classList.add('mode-auto');
            }
        } else {
            // Switch to manual colors & hide gear
            this.modeToggleBtn.classList.remove('mode-auto');
            this.modeToggleBtn.classList.add('mode-manual');
            this.agentConfigBtn.classList.add('hidden');
        }
    }
}