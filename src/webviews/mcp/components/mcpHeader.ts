import type { ServerConfig } from '../../../managers/mcpManager';
import { WebviewApi } from '../../Webview';

export class MCPHeader {
    // Stats elements
    private activeServers: HTMLElement;
    private totalServers: HTMLElement;
    private activeTools: HTMLElement;
    private totalTools: HTMLElement;

    // Dropdown & Triggers
    private addServerContainer: HTMLElement;
    private addServerDropdown: HTMLElement;
    private addServerBtn: HTMLButtonElement;
    private cancelServerBtn: HTMLButtonElement;
    private saveServerBtn: HTMLButtonElement;

    // Form inputs
    private serverName: HTMLInputElement;
    private transportType: HTMLSelectElement;
    private stdioFields: HTMLElement;
    private sseFields: HTMLElement;
    private commandInput: HTMLInputElement;
    private cwdInput: HTMLInputElement;
    private envInput: HTMLTextAreaElement;
    private urlInput: HTMLInputElement;
    private autoConnect: HTMLInputElement;

    constructor(private vscodeAPI: WebviewApi) {
        // Stats
        this.activeServers = document.getElementById('activeServers') as HTMLElement;
        this.totalServers = document.getElementById('totalServers') as HTMLElement;
        this.activeTools = document.getElementById('activeTools') as HTMLElement;
        this.totalTools = document.getElementById('totalTools') as HTMLElement;

        // UI triggers & containers
        this.addServerContainer = document.getElementById('addServerContainer') as HTMLElement;
        this.addServerDropdown = document.getElementById('addServerDropdown') as HTMLElement;
        this.addServerBtn = document.getElementById('addServerBtn') as HTMLButtonElement;
        this.cancelServerBtn = document.getElementById('cancelServerBtn') as HTMLButtonElement;
        this.saveServerBtn = document.getElementById('saveServerBtn') as HTMLButtonElement;

        // Form elements
        this.serverName = document.getElementById('serverName') as HTMLInputElement;
        this.transportType = document.getElementById('transportType') as HTMLSelectElement;
        this.stdioFields = document.getElementById('stdioFields') as HTMLElement;
        this.sseFields = document.getElementById('sseFields') as HTMLElement;
        this.commandInput = document.getElementById('command') as HTMLInputElement;
        this.cwdInput = document.getElementById('cwd') as HTMLInputElement;
        this.envInput = document.getElementById('env') as HTMLTextAreaElement;
        this.urlInput = document.getElementById('url') as HTMLInputElement;
        this.autoConnect = document.getElementById('autoConnect') as HTMLInputElement;

        this.initListeners();
    }

    private initListeners(): void {
        this.addServerBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            const isHidden = this.addServerDropdown.classList.toggle('hidden');
            if (!isHidden) {
                setTimeout(() => this.serverName.focus(), 50);
            }
        });

        const closeMenu = () => {
            this.addServerDropdown.classList.add('hidden');
            this.resetForm();
        };

        this.cancelServerBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            closeMenu();
        });

        document.addEventListener('click', (e: MouseEvent) => {
            if (e.target instanceof Node && !this.addServerContainer.contains(e.target)) {
                closeMenu();
            }
        });

        this.transportType.addEventListener('change', () => {
            if (this.transportType.value === 'stdio') {
                this.stdioFields.classList.remove('hidden');
                this.sseFields.classList.add('hidden');
            } else {
                this.stdioFields.classList.add('hidden');
                this.sseFields.classList.remove('hidden');
            }
            this.validateForm();
        });

        const validateInputs = [this.serverName, this.commandInput, this.urlInput];
        validateInputs.forEach(input => {
            input.addEventListener('input', () => this.validateForm());
        });

        this.saveServerBtn.addEventListener('click', (e: MouseEvent) => {
            e.stopPropagation();
            this.saveServer();
        });
    }

    private validateForm(): void {
        const nameValid = this.serverName.value.trim().length > 0;
        const type = this.transportType.value;
        let transportValid = false;

        if (type === 'stdio') {
            transportValid = this.commandInput.value.trim().length > 0;
        } else {
            transportValid = this.urlInput.value.trim().length > 0;
        }

        this.saveServerBtn.disabled = !(nameValid && transportValid);
    }

    private resetForm(): void {
        this.serverName.value = '';
        this.transportType.value = 'stdio';
        this.commandInput.value = '';
        this.cwdInput.value = '';
        this.envInput.value = '';
        this.urlInput.value = '';
        this.autoConnect.checked = true;

        this.stdioFields.classList.remove('hidden');
        this.sseFields.classList.add('hidden');
        this.saveServerBtn.disabled = true;
    }

    private saveServer(): void {
        const name = this.serverName.value.trim();
        const type = this.transportType.value;
        const config: ServerConfig = {};

        if (type === 'stdio') {
            config.command = this.commandInput.value.trim();

            const cwd = this.cwdInput.value.trim();
            if (cwd) config.cwd = cwd;

            const env = this.envInput.value.trim();
            if (env) {
                try {
                    config.env = JSON.parse(env);
                } catch (e) {
                    console.warn('Invalid JSON in environment variables', e);
                }
            }
        } else {
            config.url = this.urlInput.value.trim();
        }

        this.vscodeAPI.postMessage({
            type: 'addServer',
            name: name,
            config: config,
            autoConnect: this.autoConnect.checked
        });

        this.addServerDropdown.classList.add('hidden');
        this.resetForm();
    }

    public updateStats(serversActive?: number, serversTotal?: number, toolsActive?: number, toolsTotal?: number): void {
        if (serversActive !== undefined) this.activeServers.textContent = serversActive.toString();
        if (serversTotal !== undefined) this.totalServers.textContent = serversTotal.toString();
        if (toolsActive !== undefined) this.activeTools.textContent = toolsActive.toString();
        if (toolsTotal !== undefined) this.totalTools.textContent = toolsTotal.toString();
    }
}