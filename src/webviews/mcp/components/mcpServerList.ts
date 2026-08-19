import type { ServerConfig } from '../../../managers/mcpManager';
import { WebviewApi } from '../../Webview';

export class MCPServerList {
    private listContainer: HTMLElement;

    constructor(private vscodeAPI: WebviewApi) {
        this.listContainer = document.getElementById('mcp-server-list') as HTMLElement;
    }

    private initListeners() { }

    private initItemListeners(serverItem: HTMLElement, name: string): void {
        const toggleBtn = serverItem.querySelector(`#toggle-${name}`) as HTMLElement;
        const toolsList = serverItem.querySelector(`#tools-${name}`) as HTMLElement;
        const chevron = toggleBtn.querySelector('.chevron') as HTMLElement;
        const removeBtn = serverItem.querySelector('.remove-server-btn') as HTMLButtonElement;
        const serverToggle = serverItem.querySelector(`#server-toggle-${name}`) as HTMLInputElement;

        // Toggle Tools List
        toggleBtn.addEventListener('click', () => {
            const isHidden = toolsList.classList.toggle('hidden');
            chevron.textContent = isHidden ? '▶' : '▼';
        });

        // Server Connect/Disconnect Toggle
        serverToggle.addEventListener('change', () => {
            this.vscodeAPI.postMessage({
                type: 'toggleConnect',
                name: name,
                connect: serverToggle.checked
            });
        });

        // Remove Server
        removeBtn.addEventListener('click', () => {
            this.vscodeAPI.postMessage({ type: 'removeServer', name: name });
        });
    }

    public updateServerStatus(name: string, status: 'connected' | 'disconnected' | 'connecting' | 'error'): void {
        const statusDot = document.getElementById(`status-${name}`);
        if (statusDot) statusDot.className = `status-dot ${status}`;

        const serverToggle = document.getElementById(`server-toggle-${name}`) as HTMLInputElement | null;
        if (serverToggle) {
            serverToggle.checked = status === 'connected';
            serverToggle.disabled = status === 'connecting';
        }

        // If disconnected or errored, reset the tools list display
        if (status === 'disconnected' || status === 'error') {
            const toggleBtn = document.getElementById(`toggle-${name}`);
            const toolsList = document.getElementById(`tools-${name}`);
            if (toggleBtn) {
                const label = toggleBtn.querySelector('.tools-label');
                if (label) label.textContent = 'Tools (0)';
            }
            if (toolsList) {
                toolsList.innerHTML = `<div class="empty-tools">Server ${status}.</div>`;
            }
        }
    }

    public addServerItem(name: string, config: ServerConfig, status: string = 'disconnected'): void {
        if (document.getElementById(`server-${name}`)) return;

        const transportInfo = config.url
            ? `SSE: ${config.url}`
            : `STDIO: ${config.command || ''} ${config.args?.join(' ') || ''}`.trim();

        const serverItem = document.createElement('div');
        serverItem.className = 'server-item';
        serverItem.id = `server-${name}`;

        serverItem.innerHTML = `
            <div class="server-header">
                <div class="server-title-group">
                    <span class="status-dot ${status}" id="status-${name}"></span>
                    <span class="server-name">${name}</span>
                </div>
                <div class="server-actions">
                    <label class="toggle-switch" title="Connect/Disconnect Server">
                        <input type="checkbox" id="server-toggle-${name}" ${status === 'connected' ? 'checked' : ''} ${status === 'connecting' ? 'disabled' : ''}>
                        <span class="toggle-slider"></span>
                    </label>
                    <button class="icon-btn remove-server-btn" title="Remove Server">&times;</button>
                </div>
            </div>
            <div class="server-details">
                <span class="server-config">${transportInfo}</span>
            </div>
            <div class="server-tools-container">
                <div class="tools-toggle" id="toggle-${name}">
                    <span class="chevron">▶</span> 
                    <span class="tools-label">Tools (0)</span>
                </div>
                <div class="tools-list hidden" id="tools-${name}">
                    <div class="empty-tools">Connecting / No tools loaded.</div>
                </div>
            </div>
        `;

        this.initItemListeners(serverItem, name);
        this.listContainer.appendChild(serverItem);
    }

    public updateServerTools(name: string, tools: any[]): void {
        const toolsList = document.getElementById(`tools-${name}`);
        const toggleBtn = document.getElementById(`toggle-${name}`);
        if (!toolsList || !toggleBtn) return;

        const label = toggleBtn.querySelector('.tools-label');
        if (label) label.textContent = `Tools (${tools.length})`;

        if (tools.length === 0) {
            toolsList.innerHTML = `<div class="empty-tools">No tools available on this server.</div>`;
            return;
        }

        toolsList.innerHTML = tools.map(tool => {
            const isEnabled = !tool.disabled;
            return `
                <div class="tool-item ${isEnabled ? '' : 'disabled'}" id="tool-${name}-${tool.name}">
                    <div class="tool-header">
                        <span class="tool-name">${tool.name}</span>
                        <label class="toggle-switch small" title="Toggle Tool">
                            <input type="checkbox" class="tool-toggle" data-server="${name}" data-tool="${tool.name}" ${isEnabled ? 'checked' : ''}>
                            <span class="toggle-slider"></span>
                        </label>
                    </div>
                    <div class="tool-desc">${tool.description || 'No description provided.'}</div>
                </div>
            `;
        }).join('');

        const toolToggles = toolsList.querySelectorAll<HTMLInputElement>('.tool-toggle');
        toolToggles.forEach(toggle => {
            toggle.addEventListener('change', (e: Event) => {
                e.stopPropagation();
                const toolName = toggle.getAttribute('data-tool')!;
                const isEnabled = toggle.checked;

                // getElementById avoids DOMExceptions with dots/colons in tool names
                const toolCard = document.getElementById(`tool-${name}-${toolName}`);
                if (toolCard) {
                    toolCard.classList.toggle('disabled', !isEnabled);
                }

                this.vscodeAPI.postMessage({
                    type: 'toggleTool',
                    serverName: name,
                    toolName: toolName,
                    enabled: isEnabled
                });
            });
        });
    }

    public removeServerEntry(name: string): void {
        const item = document.getElementById(`server-${name}`);
        if (item) item.remove();
    }
}