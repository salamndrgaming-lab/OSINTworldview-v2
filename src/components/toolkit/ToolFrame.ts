// src/components/toolkit/ToolFrame.ts
//
// *** RENAME: delete ToolFrame.tsx → ToolFrame.ts ***
//
// FIXES:
//   - TS7016: @types/react not installed
//   - TS17004: --jsx not set
//   - TS7026: No JSX.IntrinsicElements
//   - TS2307: Cannot find module './toolDefinitions' — now created
//   - TS7031: Binding element 'tool' implicitly has any
//
// Rewritten as a plain class that builds DOM directly.

import { type ToolDefinition } from './toolDefinitions';

export class ToolFrame {
  readonly element: HTMLElement;
  private currentTool: ToolDefinition | null = null;

  constructor() {
    this.element = document.createElement('div');
    this.element.className = 'tool-frame-container';
  }

  show(tool: ToolDefinition): void {
    this.currentTool = tool;
    this.element.innerHTML = `
      <div class="tool-frame-header">
        <h3>${tool.name}</h3>
        <div class="tool-actions">
          <a href="${tool.url}" target="_blank" rel="noopener noreferrer" class="btn-open-external">
            Open in New Tab
          </a>
        </div>
      </div>
      <div class="tool-description">
        <p>${tool.description}</p>
        ${tool.usage ? `
          <details class="tool-usage">
            <summary>How to use</summary>
            <p>${tool.usage}</p>
          </details>` : ''}
      </div>
      <div class="tool-frame-wrapper">
        <div class="tool-loading" id="tool-loading-${tool.id}">
          <div class="spinner"></div>
          <p>Loading ${tool.name}…</p>
        </div>
        <div class="tool-error" id="tool-error-${tool.id}" style="display:none">
          <p>Failed to load tool. Click "Open in New Tab" to use externally.</p>
        </div>
        ${tool.embedType === 'iframe' ? `
          <iframe
            src="${tool.url}"
            title="${tool.name}"
            class="tool-iframe"
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          ></iframe>` : ''}
        ${tool.embedType === 'native' && tool.nativeComponent ? `
          <div class="tool-native" id="tool-native-${tool.id}"></div>` : ''}
      </div>`;

    if (tool.embedType === 'iframe') {
      const iframe = this.element.querySelector<HTMLIFrameElement>('.tool-iframe');
      const loading = this.element.querySelector<HTMLElement>(`#tool-loading-${tool.id}`);
      const error = this.element.querySelector<HTMLElement>(`#tool-error-${tool.id}`);

      iframe?.addEventListener('load', () => {
        if (loading) loading.style.display = 'none';
      });
      iframe?.addEventListener('error', () => {
        if (loading) loading.style.display = 'none';
        if (error) error.style.display = '';
      });
    }

    if (tool.embedType === 'native' && tool.nativeComponent) {
      const container = this.element.querySelector<HTMLElement>(`#tool-native-${tool.id}`);
      if (container) {
        const instance = new tool.nativeComponent();
        // If the native component mounts itself to a container, pass it
        void instance;
      }
    }
  }

  clear(): void {
    this.currentTool = null;
    this.element.innerHTML = '';
  }

  getCurrentTool(): ToolDefinition | null {
    return this.currentTool;
  }
}
