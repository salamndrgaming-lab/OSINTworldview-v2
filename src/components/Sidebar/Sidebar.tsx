// src/components/Sidebar/Sidebar.tsx
// BUG FIX 3: Updated Sidebar component using panel registry

import React from 'react';
import { usePanelRegistration } from './usePanelRegistration';
import { SidebarItem } from './SidebarItem';
import './Sidebar.css';

interface SidebarProps {
  collapsed?: boolean;
  onToggle?: () => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ collapsed = false, onToggle }) => {
  const { panels, categories } = usePanelRegistration();

  return (
    <aside className={`sidebar ${collapsed ? 'collapsed' : ''}`}>
      <div className="sidebar-header">
        <h2>{collapsed ? 'O' : 'OSINT Worldview'}</h2>
        <button onClick={onToggle} className="toggle-button">
          {collapsed ? '→' : '←'}
        </button>
      </div>

      <nav className="sidebar-nav">
        {Array.from(categories.entries()).map(([category, categoryPanels]) => (
          <div key={category} className="sidebar-category">
            {!collapsed && (
              <h3 className="category-title">
                {category.charAt(0).toUpperCase() + category.slice(1)}
              </h3>
            )}
            <ul className="category-items">
              {categoryPanels.map(panel => (
                <SidebarItem
                  key={panel.id}
                  id={panel.id}
                  name={panel.name}
                  icon={panel.icon}
                  collapsed={collapsed}
                  description={panel.description}
                />
              ))}
            </ul>
          </div>
        ))}
      </nav>

      {panels.length === 0 && (
        <div className="sidebar-empty">
          <p>No panels registered</p>
        </div>
      )}
    </aside>
  );
};
