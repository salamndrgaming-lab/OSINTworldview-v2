// src/components/toolkit/ToolkitPanel.tsx
// BUG FIX 6: OSINT Toolkit embedded tools panel

import React, { useState } from 'react';
import { ToolFrame } from './ToolFrame';
import { toolDefinitions } from './toolDefinitions';
import './ToolkitPanel.css';

export const ToolkitPanel: React.FC = () => {
  const [selectedTool, setSelectedTool] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const filteredTools = toolDefinitions.filter(tool =>
    tool.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tool.description.toLowerCase().includes(searchQuery.toLowerCase()) ||
    tool.category.toLowerCase().includes(searchQuery.toLowerCase())
  );

  const categories = [...new Set(toolDefinitions.map(t => t.category))];

  return (
    <div className="toolkit-panel">
      <div className="toolkit-header">
        <h2>OSINT Toolkit</h2>
        <input
          type="text"
          placeholder="Search tools..."
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          className="toolkit-search"
        />
      </div>

      <div className="toolkit-content">
        <div className="toolkit-sidebar">
          <div className="toolkit-categories">
            {categories.map(category => {
              const categoryTools = filteredTools.filter(t => t.category === category);

              return (
                <div key={category} className="category-group">
                  <h3>{category}</h3>
                  <ul>
                    {categoryTools.map(tool => (
                      <li
                        key={tool.id}
                        className={selectedTool === tool.id ? 'active' : ''}
                        onClick={() => setSelectedTool(tool.id)}
                      >
                        <span className="tool-icon">{tool.icon}</span>
                        <span className="tool-name">{tool.name}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              );
            })}
          </div>
        </div>

        <div className="toolkit-main">
          {selectedTool ? (
            <ToolFrame
              tool={toolDefinitions.find(t => t.id === selectedTool)!}
            />
          ) : (
            <div className="toolkit-welcome">
              <h3>Select a tool to get started</h3>
              <p>Choose from {toolDefinitions.length} OSINT tools on the left</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default ToolkitPanel;
