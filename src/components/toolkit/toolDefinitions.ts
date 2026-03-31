// src/components/toolkit/toolDefinitions.ts
// Created to satisfy TS2307: Cannot find module './toolDefinitions'
// Both ToolFrame.tsx and ToolkitPanel.tsx import this module.

export interface ToolDefinition {
  id: string;
  name: string;
  description: string;
  category: string;
  icon: string;
  url: string;
  embedType: 'iframe' | 'native';
  usage?: string;
  nativeComponent?: new () => { destroy?(): void };
}

export const toolDefinitions: ToolDefinition[] = [
  {
    id: 'shodan',
    name: 'Shodan',
    description: 'Search engine for Internet-connected devices',
    category: 'Cyber',
    icon: '🔍',
    url: 'https://www.shodan.io',
    embedType: 'iframe',
    usage: 'Search IP addresses, hostnames, and device fingerprints',
  },
  {
    id: 'maltego',
    name: 'Maltego Community',
    description: 'Link analysis and data mining tool',
    category: 'Network Analysis',
    icon: '🕸️',
    url: 'https://www.maltego.com',
    embedType: 'iframe',
    usage: 'Map relationships between entities',
  },
  {
    id: 'whois',
    name: 'WHOIS Lookup',
    description: 'Domain registration information',
    category: 'Domain Intel',
    icon: '🌐',
    url: 'https://who.is',
    embedType: 'iframe',
    usage: 'Look up domain registration details',
  },
  {
    id: 'virustotal',
    name: 'VirusTotal',
    description: 'File and URL malware scanner',
    category: 'Cyber',
    icon: '🛡️',
    url: 'https://www.virustotal.com',
    embedType: 'iframe',
    usage: 'Scan files, URLs, IPs, and domains',
  },
  {
    id: 'osm',
    name: 'OpenStreetMap',
    description: 'Open-source collaborative mapping',
    category: 'Geospatial',
    icon: '🗺️',
    url: 'https://www.openstreetmap.org',
    embedType: 'iframe',
    usage: 'Geospatial analysis and location verification',
  },
];
