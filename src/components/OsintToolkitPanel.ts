/**
 * OSINT Toolkit Panel
 *
 * A curated, searchable directory of open-source intelligence tools
 * and resources, organized by category. Tools load inline in an
 * embedded iframe where possible, with fallback to external tab.
 */

import { Panel } from './Panel';

interface OsintTool {
  name: string;
  url: string;
  description: string;
  category: string;
  tags: string[];
  free: boolean;
  /** Some sites block iframes via X-Frame-Options — mark those as external-only */
  externalOnly?: boolean;
}

const CATEGORIES = [
  { id: 'all', label: 'All', icon: '🔍' },
  { id: 'search', label: 'Search', icon: '🌐' },
  { id: 'social', label: 'Social Media', icon: '📱' },
  { id: 'threat', label: 'Threat Intel', icon: '🛡' },
  { id: 'geo', label: 'Geospatial', icon: '🗺' },
  { id: 'domain', label: 'Domain/IP', icon: '🌍' },
  { id: 'maritime', label: 'Maritime', icon: '🚢' },
  { id: 'aviation', label: 'Aviation', icon: '✈' },
  { id: 'imagery', label: 'Imagery', icon: '📷' },
  { id: 'people', label: 'People', icon: '👤' },
  { id: 'username', label: 'Username', icon: '🔎' },
  { id: 'documents', label: 'Documents', icon: '📄' },
  { id: 'factcheck', label: 'Fact Check', icon: '✅' },
];

const TOOLS: OsintTool[] = [
  // Search Engines
  { name: 'Google Advanced Search', url: 'https://www.google.com/advanced_search', description: 'Targeted search with filters for domain, filetype, date range', category: 'search', tags: ['google', 'dork', 'filter'], free: true, externalOnly: true },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com', description: 'Privacy-focused search engine with bang shortcuts', category: 'search', tags: ['privacy', 'search'], free: true },
  { name: 'Brave Search', url: 'https://search.brave.com', description: 'Independent search index with AI summaries', category: 'search', tags: ['privacy', 'ai'], free: true },
  { name: 'Intelligence X', url: 'https://intelx.io', description: 'Search engine for the darknet, leaks, and public records', category: 'search', tags: ['darkweb', 'leaks', 'paste'], free: false },
  { name: 'Wayback Machine', url: 'https://web.archive.org', description: 'Internet Archive — cached versions of any website over time', category: 'search', tags: ['archive', 'historical', 'cache'], free: true },
  { name: 'OSINT Framework', url: 'https://osintframework.com', description: 'Interactive tree of OSINT tools organized by data type', category: 'search', tags: ['framework', 'directory'], free: true },

  // Social Media
  { name: 'Social Searcher', url: 'https://www.social-searcher.com', description: 'Real-time social media search across multiple platforms', category: 'social', tags: ['twitter', 'facebook', 'real-time'], free: true },
  { name: 'TweetDeck', url: 'https://tweetdeck.twitter.com', description: 'Multi-column Twitter monitoring dashboard', category: 'social', tags: ['twitter', 'monitoring'], free: true, externalOnly: true },
  { name: 'Nitter', url: 'https://nitter.net', description: 'Privacy-friendly Twitter frontend for browsing without an account', category: 'social', tags: ['twitter', 'privacy'], free: true },
  { name: 'Reddit User Analyzer', url: 'https://reddit-user-analyser.netlify.app', description: 'Analyze a Reddit account activity, subreddits, and posting patterns', category: 'social', tags: ['reddit', 'analysis'], free: true },
  { name: 'Telegram Analytics', url: 'https://tgstat.com', description: 'Analytics for Telegram channels, groups, and bots', category: 'social', tags: ['telegram', 'analytics'], free: true },
  { name: 'Social Analyzer', url: 'https://github.com/qeeqbox/social-analyzer', description: 'Find a person\'s profile across 1000+ social media sites', category: 'social', tags: ['multi-platform', 'profiling'], free: true, externalOnly: true },

  // Threat Intelligence
  { name: 'Shodan', url: 'https://www.shodan.io', description: 'Search engine for internet-connected devices — find exposed servers, cameras, ICS', category: 'threat', tags: ['iot', 'infrastructure', 'exposure'], free: false },
  { name: 'GreyNoise', url: 'https://www.greynoise.io', description: 'Identify internet scanners, bots, and malicious IP behavior', category: 'threat', tags: ['ip', 'scanner', 'noise'], free: true },
  { name: 'AbuseIPDB', url: 'https://www.abuseipdb.com', description: 'IP address reputation database for abuse detection', category: 'threat', tags: ['ip', 'abuse', 'reputation'], free: true },
  { name: 'VirusTotal', url: 'https://www.virustotal.com', description: 'Analyze files, URLs, domains for malware and suspicious activity', category: 'threat', tags: ['malware', 'analysis', 'scanning'], free: true, externalOnly: true },
  { name: 'ONYPHE', url: 'https://www.onyphe.io', description: 'Cyber defense search engine indexing exposed assets', category: 'threat', tags: ['attack-surface', 'exposure'], free: false },
  { name: 'AlienVault OTX', url: 'https://otx.alienvault.com', description: 'Open threat exchange with community-sourced IoCs', category: 'threat', tags: ['ioc', 'community', 'threat-feed'], free: true },
  { name: 'MalwareBazaar', url: 'https://bazaar.abuse.ch', description: 'Search and download confirmed malware samples by hash', category: 'threat', tags: ['malware', 'samples', 'hash'], free: true },
  { name: 'Censys', url: 'https://search.censys.io', description: 'Internet-wide scanning for hosts, certificates, and services', category: 'threat', tags: ['certificates', 'scanning', 'tls'], free: true },

  // Geospatial
  { name: 'Google Earth', url: 'https://earth.google.com', description: 'Satellite imagery with historical timeline', category: 'geo', tags: ['satellite', 'historical', 'imagery'], free: true, externalOnly: true },
  { name: 'Sentinel Hub', url: 'https://apps.sentinel-hub.com/eo-browser/', description: 'ESA Copernicus satellite imagery browser — free multispectral', category: 'geo', tags: ['satellite', 'esa', 'copernicus'], free: true },
  { name: 'NASA FIRMS', url: 'https://firms.modaps.eosdis.nasa.gov/map/', description: 'Real-time global fire detection from satellite thermal data', category: 'geo', tags: ['fires', 'satellite', 'thermal'], free: true },
  { name: 'OpenStreetMap', url: 'https://www.openstreetmap.org', description: 'Community-maintained global map with detailed infrastructure', category: 'geo', tags: ['map', 'infrastructure', 'open-data'], free: true },
  { name: 'Overpass Turbo', url: 'https://overpass-turbo.eu', description: 'Query OSM data — find military bases, bridges, power plants', category: 'geo', tags: ['osm', 'query', 'infrastructure'], free: true },
  { name: 'SunCalc', url: 'https://www.suncalc.org', description: 'Sun position calculator for photo/video geolocation verification', category: 'geo', tags: ['geolocation', 'verification', 'sun'], free: true },

  // Domain / IP
  { name: 'Whois Lookup', url: 'https://whois.domaintools.com', description: 'Domain registration and ownership information', category: 'domain', tags: ['whois', 'registration', 'ownership'], free: true },
  { name: 'SecurityTrails', url: 'https://securitytrails.com', description: 'Historical DNS records, subdomains, and WHOIS data', category: 'domain', tags: ['dns', 'historical', 'subdomains'], free: true },
  { name: 'crt.sh', url: 'https://crt.sh', description: 'Certificate transparency log search — find all certs for a domain', category: 'domain', tags: ['certificates', 'tls', 'subdomain-discovery'], free: true },
  { name: 'DNSDumpster', url: 'https://dnsdumpster.com', description: 'DNS recon and research tool with domain mapping', category: 'domain', tags: ['dns', 'reconnaissance', 'mapping'], free: true },
  { name: 'BuiltWith', url: 'https://builtwith.com', description: 'Identify technologies used by any website', category: 'domain', tags: ['technology', 'stack', 'profiling'], free: true },
  { name: 'ViewDNS.info', url: 'https://viewdns.info', description: 'Reverse IP, DNS propagation, port scanner, and more', category: 'domain', tags: ['reverse-ip', 'dns', 'tools'], free: true },

  // Maritime
  { name: 'MarineTraffic', url: 'https://www.marinetraffic.com', description: 'Global vessel tracking with AIS data', category: 'maritime', tags: ['ais', 'vessels', 'tracking'], free: true },
  { name: 'VesselFinder', url: 'https://www.vesselfinder.com', description: 'Real-time vessel positions and port arrivals', category: 'maritime', tags: ['ais', 'vessels', 'ports'], free: true },
  { name: 'Global Fishing Watch', url: 'https://globalfishingwatch.org/map/', description: 'Track fishing activity and vessel behavior worldwide', category: 'maritime', tags: ['fishing', 'ais', 'behavior'], free: true },

  // Aviation
  { name: 'ADS-B Exchange', url: 'https://globe.adsbexchange.com', description: 'Unfiltered real-time aircraft tracking — no military filtering', category: 'aviation', tags: ['adsb', 'military', 'tracking'], free: true },
  { name: 'Flightradar24', url: 'https://www.flightradar24.com', description: 'Live flight tracking with aircraft details and history', category: 'aviation', tags: ['flights', 'tracking', 'commercial'], free: true },
  { name: 'FlightAware', url: 'https://flightaware.com', description: 'Flight tracking with delay data and route history', category: 'aviation', tags: ['flights', 'delays', 'routes'], free: true },
  { name: 'Airplanes.live', url: 'https://airplanes.live', description: 'Open-source ADS-B aggregator for military and civil tracking', category: 'aviation', tags: ['adsb', 'military', 'open-source'], free: true },

  // Imagery & Verification
  { name: 'Google Reverse Image', url: 'https://images.google.com', description: 'Reverse image search to find original sources', category: 'imagery', tags: ['reverse-image', 'verification'], free: true, externalOnly: true },
  { name: 'TinEye', url: 'https://tineye.com', description: 'Reverse image search engine with modification detection', category: 'imagery', tags: ['reverse-image', 'forensics'], free: true },
  { name: 'FotoForensics', url: 'https://fotoforensics.com', description: 'Image forensics — ELA, metadata, and manipulation detection', category: 'imagery', tags: ['forensics', 'manipulation', 'exif'], free: true },
  { name: 'InVID/WeVerify', url: 'https://www.invid-project.eu/tools-and-services/invid-verification-plugin/', description: 'Video verification toolkit — keyframe extraction, reverse search', category: 'imagery', tags: ['video', 'verification', 'deepfake'], free: true, externalOnly: true },
  { name: 'ExifTool', url: 'https://exiftool.org', description: 'Read and write metadata in image, audio, and video files', category: 'imagery', tags: ['metadata', 'exif', 'forensics'], free: true, externalOnly: true },

  // People Search
  { name: 'Pipl', url: 'https://pipl.com', description: 'People search engine with identity resolution', category: 'people', tags: ['identity', 'search', 'records'], free: false, externalOnly: true },
  { name: 'That\'s Them', url: 'https://thatsthem.com', description: 'Free people search — address, phone, email lookups', category: 'people', tags: ['address', 'phone', 'lookup'], free: true },
  { name: 'Hunter.io', url: 'https://hunter.io', description: 'Find professional email addresses by company domain', category: 'people', tags: ['email', 'company', 'b2b'], free: true },
  { name: 'Epieos', url: 'https://epieos.com', description: 'Find accounts linked to an email address or phone number', category: 'people', tags: ['email', 'phone', 'accounts'], free: true },

  // Username OSINT
  { name: 'Sherlock', url: 'https://github.com/sherlock-project/sherlock', description: 'Search for a username across 400+ social networks', category: 'username', tags: ['multi-platform', 'github', 'cli'], free: true, externalOnly: true },
  { name: 'WhatsMyName', url: 'https://whatsmyname.app', description: 'Username enumeration across 500+ websites', category: 'username', tags: ['enumeration', 'web'], free: true },
  { name: 'Maigret', url: 'https://github.com/soxoj/maigret', description: 'Sherlock-like username search with profile parsing', category: 'username', tags: ['username', 'profiling', 'cli'], free: true, externalOnly: true },
  { name: 'UserSearch.org', url: 'https://usersearch.org', description: 'Find people by username across social, dating, and forum sites', category: 'username', tags: ['username', 'web-based'], free: true },

  // Documents & Leaks
  { name: 'DocumentCloud', url: 'https://www.documentcloud.org', description: 'Search and analyze uploaded documents and primary sources', category: 'documents', tags: ['documents', 'primary-sources'], free: true },
  { name: 'OCCRP Aleph', url: 'https://aleph.occrp.org', description: 'Search 1B+ records from corporate registries and leaks', category: 'documents', tags: ['leaks', 'corporate', 'investigation'], free: true },
  { name: 'Offshore Leaks DB', url: 'https://offshoreleaks.icij.org', description: 'ICIJ database of offshore companies from Panama/Pandora Papers', category: 'documents', tags: ['offshore', 'panama-papers', 'corporate'], free: true },
  { name: 'Court Listener', url: 'https://www.courtlistener.com', description: 'US court opinions, oral arguments, and PACER documents', category: 'documents', tags: ['legal', 'court', 'us'], free: true },

  // Fact Checking
  { name: 'Bellingcat', url: 'https://www.bellingcat.com/resources/', description: 'OSINT investigation guides and methodology from Bellingcat', category: 'factcheck', tags: ['methodology', 'guides', 'investigation'], free: true },
  { name: 'Snopes', url: 'https://www.snopes.com', description: 'Fact-checking and debunking misinformation', category: 'factcheck', tags: ['factcheck', 'debunk'], free: true },
  { name: 'Google Fact Check Explorer', url: 'https://toolbox.google.com/factcheck/explorer', description: 'Search fact checks from around the world', category: 'factcheck', tags: ['factcheck', 'google', 'claims'], free: true, externalOnly: true },
  { name: 'ACLED', url: 'https://acleddata.com', description: 'Armed conflict location and event data for 200+ countries', category: 'factcheck', tags: ['conflict', 'data', 'events'], free: true },
];

export class OsintToolkitPanel extends Panel {
  private searchQuery = '';
  private activeCategory = 'all';
  private listEl: HTMLElement | null = null;
  private iframeWrap: HTMLElement | null = null;
  private searchBarEl: HTMLElement | null = null;
  private tabsEl: HTMLElement | null = null;

  constructor() {
    super({
      id: 'osint-toolkit',
      title: 'OSINT Toolkit',
      showCount: true,
      closable: true,
      className: 'osint-toolkit-panel',
    });
    this.setCount(TOOLS.length);
    this.buildUI();
  }

  private buildUI(): void {
    const content = this.content;
    content.style.cssText = 'padding:0;display:flex;flex-direction:column;overflow:hidden;';

    // Search bar
    this.searchBarEl = document.createElement('div');
    this.searchBarEl.className = 'otp-search';
    this.searchBarEl.innerHTML = `<input type="text" class="otp-search-input" id="otpSearch" placeholder="Search tools..." spellcheck="false" />`;
    content.appendChild(this.searchBarEl);

    // Category filter tabs
    this.tabsEl = document.createElement('div');
    this.tabsEl.className = 'panel-tabs otp-tabs';
    this.tabsEl.innerHTML = CATEGORIES.map(c =>
      `<button class="panel-tab${c.id === 'all' ? ' active' : ''}" data-cat="${c.id}">${c.icon} ${c.label}</button>`
    ).join('');
    content.appendChild(this.tabsEl);

    // Tools list
    this.listEl = document.createElement('div');
    this.listEl.className = 'otp-list';
    this.listEl.id = 'otpList';
    content.appendChild(this.listEl);

    // Iframe container (hidden by default)
    this.iframeWrap = document.createElement('div');
    this.iframeWrap.className = 'otp-iframe-wrap';
    this.iframeWrap.style.display = 'none';
    content.appendChild(this.iframeWrap);

    // Search handler
    const searchInput = this.searchBarEl.querySelector('#otpSearch') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase().trim();
      this.renderTools();
    });

    // Tab handler
    this.tabsEl.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.panel-tab') as HTMLElement;
      if (!btn) return;
      this.tabsEl!.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this.activeCategory = btn.dataset.cat || 'all';
      this.renderTools();
    });

    // Tool click handler (delegation)
    this.listEl.addEventListener('click', (e) => {
      const toolEl = (e.target as HTMLElement).closest('.otp-tool') as HTMLElement;
      if (!toolEl) return;
      e.preventDefault();
      const url = toolEl.dataset.url;
      const external = toolEl.dataset.external === 'true';
      if (!url) return;

      if (external) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        this.openInline(url, toolEl.dataset.name || 'Tool');
      }
    });

    this.renderTools();
    OsintToolkitPanel.injectStyles();
  }

  private openInline(url: string, name: string): void {
    if (!this.iframeWrap || !this.listEl || !this.searchBarEl || !this.tabsEl) return;

    // Hide list UI, show iframe
    this.listEl.style.display = 'none';
    this.searchBarEl.style.display = 'none';
    this.tabsEl.style.display = 'none';

    this.iframeWrap.style.display = 'flex';
    this.iframeWrap.innerHTML = '';

    // Toolbar with back button and external link
    const toolbar = document.createElement('div');
    toolbar.className = 'otp-iframe-toolbar';
    toolbar.innerHTML = `
      <button class="otp-iframe-back" title="Back to tools">< Back</button>
      <span class="otp-iframe-title">${this.escHtml(name)}</span>
      <a href="${this.escHtml(url)}" target="_blank" rel="noopener noreferrer" class="otp-iframe-external" title="Open in new tab">Open External</a>
    `;
    this.iframeWrap.appendChild(toolbar);

    toolbar.querySelector('.otp-iframe-back')!.addEventListener('click', () => this.closeInline());

    // Iframe
    const iframe = document.createElement('iframe');
    iframe.className = 'otp-iframe';
    iframe.src = url;
    iframe.setAttribute('sandbox', 'allow-scripts allow-same-origin allow-forms allow-popups');
    iframe.setAttribute('loading', 'lazy');
    iframe.setAttribute('referrerpolicy', 'no-referrer');
    this.iframeWrap.appendChild(iframe);

    // If iframe fails to load (X-Frame-Options), show fallback after timeout
    const fallbackTimer = setTimeout(() => {
      if (iframe.contentDocument?.body?.innerHTML === '') {
        this.showIframeFallback(url, name);
      }
    }, 5000);

    iframe.addEventListener('load', () => clearTimeout(fallbackTimer));
    iframe.addEventListener('error', () => {
      clearTimeout(fallbackTimer);
      this.showIframeFallback(url, name);
    });
  }

  private showIframeFallback(url: string, name: string): void {
    if (!this.iframeWrap) return;
    const existing = this.iframeWrap.querySelector('.otp-iframe');
    if (existing) existing.remove();

    const fallback = document.createElement('div');
    fallback.className = 'otp-iframe-fallback';
    fallback.innerHTML = `
      <div style="text-align:center;padding:24px">
        <div style="font-size:24px;margin-bottom:8px">🔒</div>
        <div style="font-size:13px;color:var(--text-primary,#e5e7eb);margin-bottom:4px">${this.escHtml(name)} blocks embedded loading</div>
        <div style="font-size:11px;color:var(--text-secondary,#888);margin-bottom:12px">This site doesn't allow iframe embedding</div>
        <a href="${this.escHtml(url)}" target="_blank" rel="noopener noreferrer"
           style="color:var(--accent-color,#f59e0b);font-size:12px;text-decoration:underline">Open in new tab</a>
      </div>
    `;
    this.iframeWrap.appendChild(fallback);
  }

  private closeInline(): void {
    if (!this.iframeWrap || !this.listEl || !this.searchBarEl || !this.tabsEl) return;
    this.iframeWrap.style.display = 'none';
    this.iframeWrap.innerHTML = '';
    this.listEl.style.display = '';
    this.searchBarEl.style.display = '';
    this.tabsEl.style.display = '';
  }

  private renderTools(): void {
    if (!this.listEl) return;

    let filtered = TOOLS;

    if (this.activeCategory !== 'all') {
      filtered = filtered.filter(t => t.category === this.activeCategory);
    }

    if (this.searchQuery) {
      filtered = filtered.filter(t =>
        t.name.toLowerCase().includes(this.searchQuery) ||
        t.description.toLowerCase().includes(this.searchQuery) ||
        t.tags.some(tag => tag.includes(this.searchQuery))
      );
    }

    this.setCount(filtered.length);

    if (filtered.length === 0) {
      this.listEl.innerHTML = '<div class="otp-empty">No tools match your search.</div>';
      return;
    }

    this.listEl.innerHTML = filtered.map(t => {
      const catObj = CATEGORIES.find(c => c.id === t.category);
      const icon = catObj?.icon || '🔧';
      const isExternal = !!t.externalOnly;
      return `<div class="otp-tool" data-url="${this.escHtml(t.url)}" data-name="${this.escHtml(t.name)}" data-external="${isExternal}" role="button" tabindex="0">
        <div class="otp-tool-header">
          <span class="otp-tool-icon">${icon}</span>
          <span class="otp-tool-name">${this.escHtml(t.name)}</span>
          ${t.free ? '<span class="otp-tag otp-free">FREE</span>' : '<span class="otp-tag otp-paid">PAID</span>'}
          ${isExternal ? '<span class="otp-tag otp-ext">EXT</span>' : '<span class="otp-tag otp-inline">INLINE</span>'}
        </div>
        <div class="otp-tool-desc">${this.escHtml(t.description)}</div>
        <div class="otp-tool-tags">${t.tags.map(tag => `<span class="otp-tool-tag">${tag}</span>`).join('')}</div>
      </div>`;
    }).join('');
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }

  private static stylesInjected = false;
  private static injectStyles(): void {
    if (OsintToolkitPanel.stylesInjected) return;
    OsintToolkitPanel.stylesInjected = true;
    const style = document.createElement('style');
    style.textContent = `
      .otp-iframe-wrap {
        flex: 1;
        display: flex;
        flex-direction: column;
        min-height: 0;
        overflow: hidden;
      }
      .otp-iframe-toolbar {
        display: flex;
        align-items: center;
        gap: 8px;
        padding: 6px 8px;
        border-bottom: 1px solid var(--border, #222);
        flex-shrink: 0;
        font-size: 11px;
      }
      .otp-iframe-back {
        background: var(--bg-tertiary, #1a1a2e);
        color: var(--text-primary, #e5e7eb);
        border: 1px solid var(--border, #333);
        border-radius: 4px;
        padding: 3px 8px;
        cursor: pointer;
        font-size: 11px;
        font-family: inherit;
      }
      .otp-iframe-back:hover { background: var(--accent-subtle, rgba(245,158,11,0.12)); }
      .otp-iframe-title {
        flex: 1;
        font-weight: 600;
        color: var(--text-primary, #e5e7eb);
        overflow: hidden;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .otp-iframe-external {
        color: var(--accent-color, #f59e0b);
        text-decoration: none;
        font-size: 10px;
        opacity: 0.8;
      }
      .otp-iframe-external:hover { opacity: 1; text-decoration: underline; }
      .otp-iframe {
        flex: 1;
        border: none;
        width: 100%;
        min-height: 0;
        background: #111;
      }
      .otp-iframe-fallback {
        flex: 1;
        display: flex;
        align-items: center;
        justify-content: center;
      }
      .otp-tag.otp-ext {
        background: rgba(239,68,68,0.15);
        color: #ef4444;
      }
      .otp-tag.otp-inline {
        background: rgba(34,197,94,0.1);
        color: #22c55e;
      }
      .otp-tool { cursor: pointer; }
    `;
    document.head.appendChild(style);
  }
}
