// src/components/toolkit/ToolFrame.tsx
// BUG FIX 6 (companion): Tool frame for embedded OSINT tools

import React, { useState, useEffect } from 'react';
import { ToolDefinition } from './toolDefinitions';

interface ToolFrameProps {
  tool: ToolDefinition;
}

export const ToolFrame: React.FC<ToolFrameProps> = ({ tool }) => {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    setError(null);
  }, [tool.id]);

  const handleLoad = () => {
    setLoading(false);
  };

  const handleError = () => {
    setLoading(false);
    setError('Failed to load tool. Click "Open in New Tab" to use externally.');
  };

  return (
    <div className="tool-frame-container">
      <div className="tool-frame-header">
        <h3>{tool.name}</h3>
        <div className="tool-actions">
          <a
            href={tool.url}
            target="_blank"
            rel="noopener noreferrer"
            className="btn-open-external"
          >
            Open in New Tab
          </a>
        </div>
      </div>

      <div className="tool-description">
        <p>{tool.description}</p>
        {tool.usage && (
          <details className="tool-usage">
            <summary>How to use</summary>
            <p>{tool.usage}</p>
          </details>
        )}
      </div>

      <div className="tool-frame-wrapper">
        {loading && (
          <div className="tool-loading">
            <div className="spinner"></div>
            <p>Loading {tool.name}...</p>
          </div>
        )}

        {error && (
          <div className="tool-error">
            <p>{error}</p>
          </div>
        )}

        {tool.embedType === 'iframe' && (
          <iframe
            src={tool.url}
            title={tool.name}
            className="tool-iframe"
            onLoad={handleLoad}
            onError={handleError}
            sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
          />
        )}

        {tool.embedType === 'native' && (
          <div className="tool-native">
            {tool.nativeComponent && <tool.nativeComponent />}
          </div>
        )}
      </div>
    </div>
  );
};
