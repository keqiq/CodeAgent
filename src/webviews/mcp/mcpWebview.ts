import './styles/mcp.css';
import { WebviewApi } from '../Webview';

interface ServerConfig {
    command?: string;
    args?: string[];
    env?: Record<string, string>;
    url?: string;
    type?: 'stdio' | 'sse';
}

interface ToolState {
    name: string;
    description: string;
    enabled: boolean;
}

interface ServerState {
    name: string;
    status: 'connected' | 'disconnected' | 'connecting' | 'error';
    config?: ServerConfig;
    tools?: ToolState[];
    error?: string;
}

declare function acquireVsCodeApi<StateType = any>(): WebviewApi<StateType>;
const vscodeAPI: WebviewApi = acquireVsCodeApi();

document.addEventListener('DOMContentLoaded', () => {
    // Header & List Elements
    const serverList = document.getElementById('serverList') as HTMLElement;
    const emptyState = document.getElementById('emptyState') as HTMLElement;
    const serverCountBadge = document.getElementById('serverCountBadge') as HTMLElement;

    // Form Toggle Elements
    const toggleAddServerBtn = document.getElementById('toggleAddServerBtn') as HTMLButtonElement;
    const cancelAddServerBtn = document.getElementById('cancelAddServerBtn') as HTMLButtonElement;
    const emptyAddBtn = document.getElementById('emptyAddBtn') as HTMLButtonElement;
    const addServerForm = document.getElementById('addServerForm') as HTMLElement;

    // Form Input Elements
    const serverNameInput = document.getElementById('serverNameInput') as HTMLInputElement;
    const serverTransportSelect = document.getElementById('serverTransportSelect') as HTMLSelectElement;
    const stdioFields = document.getElementById('stdioFields') as HTMLElement;
    const sseFields = document.getElementById('sseFields') as HTMLElement;
    const serverCommandInput = document.getElementById('serverCommandInput') as HTMLInputElement;
    const serverArgsInput = document.getElementById('serverArgsInput') as HTMLInputElement;
    const serverEnvInput = document.getElementById('serverEnvInput') as HTMLTextAreaElement;
    const serverUrlInput = document.getElementById('serverUrlInput') as HTMLInputElement;
    const autoConnectCheckbox = document.getElementById('autoConnectCheckbox') as HTMLInputElement;
    const saveServerBtn = document.getElementById('saveServerBtn') as HTMLButtonElement;

    let servers: ServerState[] = [];
    const expandedServers = new Set<string>();

    // --- FORM LOGIC ---

    function resetForm(): void {
        serverNameInput.value = '';
        serverCommandInput.value = '';
        serverArgsInput.value = '';
        serverEnvInput.value = '';
        serverUrlInput.value = '';
        serverTransportSelect.value = 'stdio';
        stdioFields.classList.remove('hidden');
        sseFields.classList.add('hidden');
        autoConnectCheckbox.checked = true;
    }

    function toggleForm(open?: boolean): void {
        const isHidden = addServerForm.classList.contains('hidden');
        const shouldOpen = open !== undefined ? open : isHidden;

        if (shouldOpen) {
            addServerForm.classList.remove('hidden');
            serverNameInput.focus();
        } else {
            addServerForm.classList.add('hidden');
            resetForm();
        }
    }

    serverTransportSelect.addEventListener('change', () => {
        if (serverTransportSelect.value === 'stdio') {
            stdioFields.classList.remove('hidden');
            sseFields.classList.add('hidden');
        } else {
            stdioFields.classList.add('hidden');
            sseFields.classList.remove('hidden');
        }
    });

    toggleAddServerBtn?.addEventListener('click', () => toggleForm());
    cancelAddServerBtn?.addEventListener('click', () => toggleForm(false));
    emptyAddBtn?.addEventListener('click', () => toggleForm(true));

    saveServerBtn?.addEventListener('click', () => {
        const name = serverNameInput.value.trim();
        if (!name) {
            serverNameInput.focus();
            return;
        }

        const transport = serverTransportSelect.value;
        const config: ServerConfig = { type: transport as 'stdio' | 'sse' };

        if (transport === 'stdio') {
            const command = serverCommandInput.value.trim();
            if (!command) {
                serverCommandInput.focus();
                return;
            }
            config.command = command;

            const args = serverArgsInput.value.trim();
            if (args) {
                config.args = args.match(/(?:[^\s"]+|"[^"]*")+/g)?.map(a => a.replace(/(^"|"$)/g, '')) || [];
            }

            const envRaw = serverEnvInput.value.trim();
            if (envRaw) {
                try {
                    config.env = JSON.parse(envRaw);
                } catch {
                    alert('Environment variables must be valid JSON');
                    return;
                }
            }
        } else {
            const url = serverUrlInput.value.trim();
            if (!url) {
                serverUrlInput.focus();
                return;
            }
            config.url = url;
        }

        const autoConnect = autoConnectCheckbox.checked;

        vscodeAPI.postMessage({
            type: 'addServer',
            name,
            config,
            autoConnect
        });

        toggleForm(false);
    });

    // --- RENDER SERVERS ---

    function renderServers(serverListState: any): void {
        let list: ServerState[] = [];
        if (Array.isArray(serverListState)) {
            list = serverListState;
        } else if (serverListState && typeof serverListState === 'object') {
            list = Object.values(serverListState);
        }

        servers = list;
        serverList.innerHTML = '';

        serverCountBadge.textContent = String(servers.length);

        if (servers.length === 0) {
            emptyState.classList.remove('hidden');
            serverList.classList.add('hidden');
            return;
        }

        emptyState.classList.add('hidden');
        serverList.classList.remove('hidden');

        servers.forEach(server => {
            const isExpanded = expandedServers.has(server.name);
            const card = document.createElement('div');
            card.className = `server-card ${isExpanded ? 'is-expanded' : ''}`;

            const isConnected = server.status === 'connected';
            const isConnecting = server.status === 'connecting';
            const statusClass = server.status || 'disconnected';

            // Top Bar
            const topDiv = document.createElement('div');
            topDiv.className = 'card-top';

            const idDiv = document.createElement('div');
            idDiv.className = 'card-identity';

            const chevron = document.createElement('span');
            chevron.className = 'chevron-icon';
            chevron.innerHTML = `
                <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" clip-rule="evenodd" d="M6.22 3.22a.75.75 0 011.06 0l4.25 4.25a.75.75 0 010 1.06l-4.25 4.25a.75.75 0 01-1.06-1.06L9.94 8 6.22 4.28a.75.75 0 010-1.06z"/>
                </svg>
            `;

            const dot = document.createElement('span');
            dot.className = `status-dot ${statusClass}`;
            dot.title = `Status: ${statusClass}`;

            const name = document.createElement('span');
            name.className = 'server-name';
            name.textContent = server.name;

            idDiv.appendChild(chevron);
            idDiv.appendChild(dot);
            idDiv.appendChild(name);

            // Toggle expansion on clicking identity
            idDiv.addEventListener('click', () => {
                if (expandedServers.has(server.name)) {
                    expandedServers.delete(server.name);
                } else {
                    expandedServers.add(server.name);
                }
                renderServers(servers);
            });

            const actionsDiv = document.createElement('div');
            actionsDiv.className = 'card-actions';

            // Toggle Connect / Disconnect button
            const toggleBtn = document.createElement('button');
            toggleBtn.className = `toggle-btn ${isConnected ? 'state-connected' : ''}`;
            toggleBtn.textContent = isConnecting ? 'CONNECTING...' : (isConnected ? 'ON' : 'OFF');
            toggleBtn.disabled = isConnecting;

            toggleBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscodeAPI.postMessage({
                    type: 'toggleConnect',
                    name: server.name,
                    connect: !isConnected
                });
            });

            // Delete action with inline confirmation
            const deleteBtn = document.createElement('button');
            deleteBtn.className = 'icon-btn delete-btn';
            deleteBtn.title = 'Delete Server';
            deleteBtn.innerHTML = `
                <svg width="14" height="14" viewBox="0 0 16 16" fill="currentColor">
                    <path fill-rule="evenodd" clip-rule="evenodd"
                        d="M10 3h3v1h-1v9l-1 1H4l-1-1V4H2V3h3V2a1 1 0 0 1 1-1h3a1 1 0 0 1 1 1v1zM9 2H6v1h3V2zM4 13h7V4H4v9zm2-8H5v7h1V5zm1 0h1v7H7V5zm2 0h1v7H9V5z" />
                </svg>
            `;

            const confirmBtn = document.createElement('button');
            confirmBtn.className = 'delete-confirm-btn hidden';
            confirmBtn.innerHTML = '<span>Confirm</span>';

            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                deleteBtn.classList.add('hidden');
                confirmBtn.classList.remove('hidden');
            });

            confirmBtn.addEventListener('click', (e) => {
                e.stopPropagation();
                vscodeAPI.postMessage({
                    type: 'removeServer',
                    name: server.name
                });
            });

            document.addEventListener('click', (e) => {
                if (!confirmBtn.contains(e.target as Node) && !deleteBtn.contains(e.target as Node)) {
                    confirmBtn.classList.add('hidden');
                    deleteBtn.classList.remove('hidden');
                }
            });

            actionsDiv.appendChild(toggleBtn);
            actionsDiv.appendChild(deleteBtn);
            actionsDiv.appendChild(confirmBtn);

            topDiv.appendChild(idDiv);
            topDiv.appendChild(actionsDiv);
            card.appendChild(topDiv);

            // Details / Command preview
            const detailsDiv = document.createElement('div');
            detailsDiv.className = 'card-details';

            if (server.config?.command) {
                const cmdSpan = document.createElement('span');
                cmdSpan.className = 'command-preview';
                const argsStr = server.config.args ? ` ${server.config.args.join(' ')}` : '';
                cmdSpan.textContent = `${server.config.command}${argsStr}`;
                detailsDiv.appendChild(cmdSpan);
            } else if (server.config?.url) {
                const urlSpan = document.createElement('span');
                urlSpan.className = 'command-preview';
                urlSpan.textContent = server.config.url;
                detailsDiv.appendChild(urlSpan);
            }

            if (server.tools && server.tools.length > 0) {
                const summaryRow = document.createElement('div');
                summaryRow.className = 'tool-summary-row';
                const enabledCount = server.tools.filter(t => t.enabled !== false).length;
                summaryRow.innerHTML = `<span class="tools-count-link">${enabledCount}/${server.tools.length} tool(s) active</span>`;

                summaryRow.addEventListener('click', () => {
                    if (expandedServers.has(server.name)) {
                        expandedServers.delete(server.name);
                    } else {
                        expandedServers.add(server.name);
                    }
                    renderServers(servers);
                });

                detailsDiv.appendChild(summaryRow);
            }

            if (server.error) {
                const errorSpan = document.createElement('span');
                errorSpan.className = 'error-text';
                errorSpan.textContent = server.error;
                detailsDiv.appendChild(errorSpan);
            }

            card.appendChild(detailsDiv);

            // Expanded Drawer for Tools
            if (isExpanded && server.tools && server.tools.length > 0) {
                const drawer = document.createElement('div');
                drawer.className = 'tools-drawer';

                const drawerTitle = document.createElement('span');
                drawerTitle.className = 'tools-drawer-title';
                drawerTitle.textContent = 'Registered Tools';
                drawer.appendChild(drawerTitle);

                const toolsList = document.createElement('div');
                toolsList.className = 'tools-list';

                server.tools.forEach(tool => {
                    const isToolEnabled = tool.enabled !== false;
                    const toolItem = document.createElement('div');
                    toolItem.className = `tool-item ${!isToolEnabled ? 'disabled' : ''}`;

                    const toolInfo = document.createElement('div');
                    toolInfo.className = 'tool-item-info';

                    const toolName = document.createElement('span');
                    toolName.className = 'tool-item-name';
                    toolName.textContent = tool.name;

                    const toolDesc = document.createElement('span');
                    toolDesc.className = 'tool-item-desc';
                    toolDesc.textContent = tool.description || 'No description provided.';

                    toolInfo.appendChild(toolName);
                    toolInfo.appendChild(toolDesc);

                    // Switch
                    const switchLabel = document.createElement('label');
                    switchLabel.className = 'switch';

                    const checkbox = document.createElement('input');
                    checkbox.type = 'checkbox';
                    checkbox.checked = isToolEnabled;

                    checkbox.addEventListener('change', (e) => {
                        e.stopPropagation();
                        vscodeAPI.postMessage({
                            type: 'toggleTool',
                            serverName: server.name,
                            toolName: tool.name,
                            enabled: checkbox.checked
                        });
                    });

                    const slider = document.createElement('span');
                    slider.className = 'slider';

                    switchLabel.appendChild(checkbox);
                    switchLabel.appendChild(slider);

                    toolItem.appendChild(toolInfo);
                    toolItem.appendChild(switchLabel);

                    toolsList.appendChild(toolItem);
                });

                drawer.appendChild(toolsList);
                card.appendChild(drawer);
            }

            serverList.appendChild(card);
        });
    }

    // --- MESSAGE ROUTING ---

    window.addEventListener('message', (event: MessageEvent) => {
        const msg = event.data;

        switch (msg.type) {
            case 'syncState':
                renderServers(msg.servers);
                break;
            default:
                break;
        }
    });

    vscodeAPI.postMessage({ type: 'mcpViewReady' });
});