import { WebviewApi } from "../../../Webview";

interface ParsedPatchFile {
    filename: string;
    additions: number;
    deletions: number;
    isNew: boolean;
    isDeleted: boolean;
}

interface ParsedPatchResult {
    files: ParsedPatchFile[];
    totalAdditions: number;
    totalDeletions: number;
}

export class PatchContainer {
    private activePatchContainer: HTMLElement | null = null;

    constructor(private container: HTMLElement, patchString: string, private vscodeAPI: WebviewApi) {

        const {files, totalAdditions, totalDeletions} = PatchContainer.parsePatch(patchString);
        if (files.length === 0) return;

        this.activePatchContainer = document.createElement('div');
        this.activePatchContainer.classList.add('patch-review-container');

        // Header contains all line insertions, deletions, file creations, deletions 
        const summaryHeader = document.createElement('div');
        summaryHeader.classList.add('patch-summary-header');

        const summaryText = document.createElement('div');
        summaryText.classList.add('patch-summary-text');

        summaryText.innerHTML = `
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg"><g id="SVGRepo_bgCarrier" stroke-width="0"></g><g id="SVGRepo_tracerCarrier" stroke-linecap="round" stroke-linejoin="round"></g><g id="SVGRepo_iconCarrier"> <path d="M9 6C9 7.65685 7.65685 9 6 9C4.34315 9 3 7.65685 3 6C3 4.34315 4.34315 3 6 3C7.65685 3 9 4.34315 9 6Z" stroke="#bdbdbd" stroke-width="2"></path> <path d="M9 18C9 19.6569 7.65685 21 6 21C4.34315 21 3 19.6569 3 18C3 16.3431 4.34315 15 6 15C7.65685 15 9 16.3431 9 18Z" stroke="#bdbdbd" stroke-width="2"></path> <path d="M21 18C21 19.6569 19.6569 21 18 21C16.3431 21 15 19.6569 15 18C15 16.3431 16.3431 15 18 15C19.6569 15 21 16.3431 21 18Z" stroke="#bdbdbd" stroke-width="2"></path> <path d="M12 6C14.8284 6 16.2426 6 17.1213 6.87868C18 7.75736 18 9.17157 18 12V15" stroke="#bdbdbd" stroke-width="2"></path> <path d="M15 3L12.0605 5.93945V5.93945C12.0271 5.97289 12.0271 6.02711 12.0605 6.06055V6.06055L15 9" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> <path d="M6 15V9" stroke="#bdbdbd" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"></path> </g></svg>
            <span><b>Staged Changes:</b> ${files.length} file${files.length > 1 ? 's' : ''} 
            <span class="patch-stat-add">+${totalAdditions}</span> 
            <span class="patch-stat-del">-${totalDeletions}</span></span>
        `;

        // apply or discard patch action
        const actionsContainer = document.createElement('div');
        actionsContainer.classList.add('patch-actions');

        const discardBtn = document.createElement('button');
        discardBtn.classList.add('patch-btn', 'discard-btn');
        discardBtn.textContent = 'Discard';
        discardBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            this.vscodeAPI.postMessage({ type: 'discardChanges' });
        };

        const applyBtn = document.createElement('button');
        applyBtn.classList.add('patch-btn', 'apply-btn');
        applyBtn.textContent = 'Apply';
        applyBtn.onclick = (e: MouseEvent) => {
            e.stopPropagation();
            this.vscodeAPI.postMessage({ type: 'applyChanges' });
        };

        actionsContainer.appendChild(discardBtn);
        actionsContainer.appendChild(applyBtn);

        summaryHeader.appendChild(summaryText);
        summaryHeader.appendChild(actionsContainer);

        // File list with details
        const fileList = document.createElement('div');
        fileList.classList.add('patch-file-list');

        files.forEach((file: ParsedPatchFile) => {
            const fileItem = document.createElement('div');
            fileItem.classList.add('patch-file-item');

            let statusIcon = '';
            if (file.isNew) statusIcon = `<span class="file-status-icon added">A</span>`;
            else if (file.isDeleted) statusIcon = `<span class="file-status-icon deleted">D</span>`;
            else statusIcon = `<span class="file-status-icon modified">M</span>`;

            fileItem.innerHTML = `
                <div class="file-item-left">
                    ${statusIcon}
                    <span class="file-name">${file.filename}</span>
                </div>
                <div class="file-item-right">
                    ${file.additions > 0 ? `<span class="patch-stat-add">+${file.additions}</span>` : ''}
                    ${file.deletions > 0 ? `<span class="patch-stat-del">-${file.deletions}</span>` : ''}
                </div>
            `;

            fileItem.onclick = () => {
                this.vscodeAPI.postMessage({ type: 'openDiffView', file: file.filename, isNew: file.isNew, isDeleted: file.isDeleted });
            };

            fileList.appendChild(fileItem);
        });

        // Open the file list when clicking the summary header
        summaryHeader.onclick = () => fileList.classList.toggle('hidden');

        this.activePatchContainer.appendChild(summaryHeader);
        this.activePatchContainer.appendChild(fileList);

        this.container.appendChild(this.activePatchContainer);
    }

    private static parsePatch(patchString: string): ParsedPatchResult {
        const lines = patchString.split('\n');
        const files: ParsedPatchFile[] = [];
        let currentFile: ParsedPatchFile | null = null;

        let totalAdditions = 0;
        let totalDeletions = 0;

        for (const line of lines) {

            // Begin parsing new file
            if (line.startsWith('diff --git')) {
                const match = line.match(/^diff --git a\/(.+?) b\/(.+?)$/);
                const filename = match ? match[2] : 'unknown';

                currentFile = { filename, additions: 0, deletions: 0, isNew: false, isDeleted: false };
                files.push(currentFile);
            }

            // Update current file
            else if (currentFile) {
                if (line.startsWith('new file mode')) currentFile.isNew = true;                     // added
                else if (line.startsWith('deleted file mode')) currentFile.isDeleted = true;        // deleted
                else if (line.startsWith('+') && !line.startsWith('+++')) {
                    currentFile.additions++;  // insertion
                    totalAdditions++;
                }
                else if (line.startsWith('-') && !line.startsWith('---')) {
                    currentFile.deletions++;  // deletion
                    totalDeletions++;
                }
            }
        }

        return {files, totalAdditions, totalDeletions};
    }

    public update(status: 'accepted' | 'rejected' | 'conflict'): void {
        if (!this.activePatchContainer) return;

        const summaryHeader = this.activePatchContainer.querySelector('.patch-summary-header') as HTMLElement;
        const actionsContainer = this.activePatchContainer.querySelector('.patch-actions') as HTMLElement;

        if (summaryHeader && actionsContainer) {
            // We do not close the accordion for a conflict
            if (status === 'conflict') {
                this.renderConflictUI(actionsContainer);
                return; 
            }
            // Disable the patch container after decision
            actionsContainer.innerHTML = '';

            const badge = document.createElement('span');
            
            const cssStatus = status === 'accepted' ? 'status-ok' : 'status-error';
            badge.classList.add('status-highlight', cssStatus);
            badge.textContent = status === 'accepted' ? 'Applied' : 'Discarded';

            actionsContainer.appendChild(badge);
            summaryHeader.style.cursor = 'default';
            summaryHeader.onclick = null;
        }

        // close the file list
        const fileList = this.activePatchContainer.querySelector('.patch-file-list');
        if (fileList) fileList.remove();

        this.activePatchContainer = null;
    }

    private renderConflictUI(actionsContainer: HTMLElement): void {
        actionsContainer.innerHTML = '';

        const badge = document.createElement('span');
        badge.classList.add('status-highlight', 'status-warning');
        badge.textContent = 'Merge Conflict';
        
        const forceBtn = document.createElement('button');
        forceBtn.classList.add('patch-btn', 'discard-btn');
        forceBtn.textContent = 'Force Apply';
        forceBtn.title = 'Overwrite conflicts with agent changes';
        forceBtn.onclick = (e) => { e.stopPropagation(); this.vscodeAPI.postMessage({ type: 'forceApplyPatch' }); };

        const resolveBtn = document.createElement('button');
        resolveBtn.classList.add('patch-btn', 'apply-btn');
        resolveBtn.textContent = 'Mark Resolved';
        resolveBtn.title = 'Accept changes after manual resolution in VS Code';
        resolveBtn.onclick = (e) => { e.stopPropagation(); this.vscodeAPI.postMessage({ type: 'markResolved' }); };
        
        // Tiny discard 'X' just in case they decide to completely cancel the whole thing
        const discardBtn = document.createElement('button');
        discardBtn.classList.add('patch-btn', 'discard-btn');
        discardBtn.innerHTML = '&#10006;'; 
        discardBtn.title = 'Discard completely';
        discardBtn.style.padding = '4px 6px';
        discardBtn.onclick = (e) => { e.stopPropagation(); this.vscodeAPI.postMessage({ type: 'discardChanges' }); };

        actionsContainer.appendChild(badge);
        actionsContainer.appendChild(forceBtn);
        actionsContainer.appendChild(resolveBtn);
        actionsContainer.appendChild(discardBtn);
    }

    public end(): void {
        if (this.activePatchContainer) {
            this.activePatchContainer.remove();
            this.activePatchContainer = null;
        }
    }
}