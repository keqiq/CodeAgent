let chatContainer;
let activeStreamDiv = null;
let activeStreamRawText = "";
let activeToolGroup = null;
let activeToolSummary = null;
let activeToolLogs = null;
let activeTool = null;
let toolErrorCount = 0;

let activeThoughtDetails = null;
let activeThoughtContent = null;
let activeThoughtRawText = '';
let thoughtStartTime = 0;

export function initChat(vscode) {
    chatContainer = document.getElementById('chatContainer');
    const scrollToBottomBtn = document.getElementById('scrollToBottomBtn');

    if (!chatContainer || !scrollToBottomBtn) return;

    chatContainer.addEventListener('scroll', () => {
        const distanceToBottom = chatContainer.scrollHeight - chatContainer.scrollTop - chatContainer.clientHeight;
        if (distanceToBottom > 50) scrollToBottomBtn.classList.add('visible');
        else scrollToBottomBtn.classList.remove('visible');
    });

    scrollToBottomBtn.addEventListener('click', () => {
        scrollToBottom();
    });
}

// On extension reload, restore chat history (tool logs exluded)
export function restoreChatHistory(msg) {
    clearChatUI();

    msg.history.forEach(msg => {
        // Do not add tool calls to the chat window, handled by tool group
        if (msg.role === 'user' || (msg.role === 'assistant' && !msg.content.startsWith('['))) appendMessage(msg);
    });
}

// Add user and agent responses to chat window
export function appendMessage(msg) {
    removeTypingIndicator();
    const text = msg.content || '';
    const role = msg.role;

    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', role);

    if (role === 'tool' || role === 'system') return;

    // Agent responses need markdown and code formatting
    if (role === 'assistant') {
        msgDiv.innerHTML = parseMarkdown(text);
        msgDiv.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });
        chatContainer.appendChild(msgDiv);
    } 
    
    // User prompts needs to be collapsable
    else if (role === 'user') {
        const textContainer = document.createElement('div');
        textContainer.classList.add('user-text-content');
        textContainer.textContent = text;
        msgDiv.appendChild(textContainer);

        const lineCount = text.split('\n').length;
        if (text.length > 250 || lineCount > 5) {
            textContainer.classList.add('clamped');
            const toggleBtn = document.createElement('button');
            toggleBtn.classList.add('toggle-text-btn');
            toggleBtn.textContent = 'Show More';

            toggleBtn.addEventListener('click', () => {
                if (textContainer.classList.contains('clamped')) {
                    textContainer.classList.remove('clamped');
                    toggleBtn.textContent = 'Show Less';
                } else {
                    textContainer.classList.add('clamped');
                    toggleBtn.textContent = 'Show More';
                    msgDiv.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                }
            });
            msgDiv.appendChild(toggleBtn);
        }
        chatContainer.appendChild(msgDiv);
    }
    scrollToBottom();
}

// Streaming response div creation and updates
export function streamMessage(message) {

    // I believe thought ends before the model resposne with messages
    endThought();
    if (!activeStreamDiv) {
        removeTypingIndicator();
        activeStreamDiv = document.createElement('div');
        activeStreamDiv.classList.add('message', 'agent');
        chatContainer.appendChild(activeStreamDiv);
    }
    activeStreamRawText += message.chunk;
    activeStreamDiv.innerHTML = parseMarkdown(activeStreamRawText);
    scrollToBottom();
}

export function endStream() {
    if (!activeStreamDiv) return;

    activeStreamDiv.querySelectorAll('pre code').forEach((block) => {
        hljs.highlightElement(block);
    });

    activeStreamDiv = null;
    activeStreamRawText = "";
}

// Streaming thought process
export function streamThought(msg) {
    removeTypingIndicator();
    if (!activeThoughtDetails) {
        thoughtStartTime = Date.now();

        activeThoughtDetails = document.createElement('details');
        activeThoughtDetails.classList.add('thought-group');

        const summary = document.createElement('summary');
        summary.innerHTML = `
            <div class="typing-indicator" style="display:inline-flex; margin-right: 8px;">
                <span></span><span></span><span></span>
            </div> 
            <span>Thinking...</span>
        `;
    
        activeThoughtContent = document.createElement('div');
        activeThoughtContent.classList.add('thought-content', 'message', 'agent');
    
        activeThoughtDetails.appendChild(summary);
        activeThoughtDetails.appendChild(activeThoughtContent);
        chatContainer.appendChild(activeThoughtDetails);
    }

    activeThoughtRawText += msg.chunk;
    activeThoughtContent.innerHTML = parseMarkdown(activeThoughtRawText);
    scrollToBottom();
}

function endThought () {
    if (activeThoughtDetails) {
        const duration = ((Date.now() - thoughtStartTime) / 1000).toFixed(1);

        const summary = activeThoughtDetails.querySelector('summary');
        if (summary) summary.innerHTML = `<span>Thought for ${duration} seconds</span>`;

        activeThoughtDetails.querySelectorAll('pre code').forEach((block) => {
            hljs.highlightElement(block);
        });

        activeThoughtDetails = null;
        activeThoughtContent = null;
        activeThoughtRawText = '';
    }
}
// Tool groups are collapsable panels that show tool execution status, tool results
export function makeCurrentToolGroup(message) {
    removeTypingIndicator();
    activeToolGroup = document.createElement('details');
    activeToolGroup.classList.add('tool-group');

    activeToolSummary = document.createElement('summary');
    activeToolSummary.innerHTML = `<div class="vscode-spinner"></div> Initializing tools...`;

    activeToolLogs = document.createElement('div');
    activeToolLogs.classList.add('tool-logs');

    activeToolGroup.appendChild(activeToolSummary);
    activeToolGroup.appendChild(activeToolLogs);
    chatContainer.appendChild(activeToolGroup);
    scrollToBottom();
}

// When the agent finishes a tool, create a tool entry in the current group
export function updateCurrentToolGroup(message) {
    if (!activeToolGroup) return;

    if  (message.status === 'running') {
        if (activeToolSummary) {
            activeToolSummary.innerHTML = `<div class="vscode-spinner"></div> Running <b>${message.toolName}</b>...`;
        }
        activeTool = document.createElement('div');
        activeTool.classList.add('tool-log-entry');

        const displayArgs = formatToolArgs(message.args);

        activeTool.innerHTML = `
            <div style="display: flex; align-items: center;">
                <span class="tool-icon log-running" style="margin-right: 4px;">⏳</span> 
                <b>${message.toolName}</b>
            </div>
            ${displayArgs}
        `;
        activeToolLogs.appendChild(activeTool);
    }
    else if (message.status === 'success') {
        if (activeTool) {
            const icon = activeTool.querySelector('.tool-icon');
            if (icon) {
                icon.className = 'tool-icon log-success';
                icon.textContent = '✔';
            }
        }
    }
    else if (message.status === 'error') {
        toolErrorCount++;
        if (activeTool) {
            activeTool.classList.add('log-error');
            const icon = activeTool.querySelector('.tool-icon');
            if (icon) {
                icon.className = 'tool-icon log-error';
                icon.textContent = '✖';
            }
            activeTool.innerHTML += `<div style="margin-left: 18px; margin-top: 4px; opacity: 0.9;">${message.error}</div>`;
        }
    }
    scrollToBottom();
}

export function endCurrentToolGroup(message) {
    if (!activeToolGroup) return;

    if (toolErrorCount > 0) activeToolSummary.textContent = `⚠️ Completed with ${toolErrorCount} error(s)`;
    else activeToolSummary.textContent = `✅ ${message.totalCount} tool(s) executed successfully`;

    activeToolGroup = null;
    activeToolSummary = null;
    activeToolLogs = null;
    activeTool = null;
    toolErrorCount = 0;
}

export function clearChatUI() {
    chatContainer.innerHTML = '';
}

function scrollToBottom() {
    chatContainer.scrollTo({ top: chatContainer.scrollHeight, behavior: 'smooth' });
}

function parseMarkdown(text) {
    marked.setOptions({ gfm: true, breaks: true });
    return marked.parse(text);
}

export function showTypingIndicator() {
    const msgDiv = document.createElement('div');
    msgDiv.classList.add('message', 'agent');
    msgDiv.id = 'typingIndicator';
    msgDiv.innerHTML = '<div class="typing-indicator"><span></span><span></span><span></span></div>';
    chatContainer.appendChild(msgDiv);
    scrollToBottom();
}

function removeTypingIndicator() {
    const indicator = document.getElementById('typingIndicator');
    if (indicator) indicator.remove();
}

function formatToolArgs(args) {
    try {
        const parsed = typeof args === 'string' ? JSON.parse(args) : args;

        if (!parsed || Object.keys(parsed).length === 0) return '';

        let html = '<div class="arg-block">';
        for (const [key, value] of Object.entries(parsed)) {
            let displayValue = '';

            if (typeof value === 'string' && value.includes('\n')) {
                const safeValue = value.replace(/</g, '&lt;').replace(/>/g, '&gt;');
                displayValue = `<div class="arg-multiline">${safeValue}</div>`;
            } else {
                displayValue = `<span class="arg-string">"${value}"</span>`;
            }
            html += `<div class="arg-row"><span class="arg-key">${key}:</span> ${displayValue}</div>`;
        }
        html += '</div>';
        return html;
    } catch (e) {
        // fallback to unformatted string
        return `<span style="opacity: 0.8; margin-left: 6px;">(${JSON.stringify(args)})</span>`;
    }
}