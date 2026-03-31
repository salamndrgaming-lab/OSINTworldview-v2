/**
 * OSINT Toolkit Panel
 *
 * A curated, searchable directory of open-source intelligence tools
 * and resources, organized by category. Users can search, filter,
 * and launch tools directly. This positions World Monitor as a
 * genuine OSINT workstation, not just a dashboard.
 *
 * Categories: Search, Social Media, Threat Intel, Geospatial,
 * Domain/IP, Maritime, Aviation, Imagery, Dark Web, People,
 * Username, Documents, Fact Check
 */

import { Panel } from './Panel';

interface OsintTool {
  name: string;
  url: string;
  description: string;
  category: string;
  tags: string[];
  free: boolean;
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
  { name: 'Google Advanced Search', url: 'https://www.google.com/advanced_search', description: 'Targeted search with filters for domain, filetype, date range', category: 'search', tags: ['google', 'dork', 'filter'], free: true },
  { name: 'DuckDuckGo', url: 'https://duckduckgo.com', description: 'Privacy-focused search engine with bang shortcuts', category: 'search', tags: ['privacy', 'search'], free: true },
  { name: 'Brave Search', url: 'https://search.brave.com', description: 'Independent search index with AI summaries', category: 'search', tags: ['privacy', 'ai'], free: true },
  { name: 'Intelligence X', url: 'https://intelx.io', description: 'Search engine for the darknet, leaks, and public records', category: 'search', tags: ['darkweb', 'leaks', 'paste'], free: false },
  { name: 'Wayback Machine', url: 'https://web.archive.org', description: 'Internet Archive — cached versions of any website over time', category: 'search', tags: ['archive', 'historical', 'cache'], free: true },
  { name: 'OSINT Framework', url: 'https://osintframework.com', description: 'Interactive tree of OSINT tools organized by data type', category: 'search', tags: ['framework', 'directory'], free: true },

  // Social Media
  { name: 'Social Searcher', url: 'https://www.social-searcher.com', description: 'Real-time social media search across multiple platforms', category: 'social', tags: ['twitter', 'facebook', 'real-time'], free: true },
  { name: 'TweetDeck', url: 'https://tweetdeck.twitter.com', description: 'Multi-column Twitter monitoring dashboard', category: 'social', tags: ['twitter', 'monitoring'], free: true },
  { name: 'Nitter', url: 'https://nitter.net', description: 'Privacy-friendly Twitter frontend for browsing without an account', category: 'social', tags: ['twitter', 'privacy'], free: true },
  { name: 'Reddit User Analyzer', url: 'https://reddit-user-analyser.netlify.app', description: 'Analyze a Reddit account activity, subreddits, and posting patterns', category: 'social', tags: ['reddit', 'analysis'], free: true },
  { name: 'Telegram Analytics', url: 'https://tgstat.com', description: 'Analytics for Telegram channels, groups, and bots', category: 'social', tags: ['telegram', 'analytics'], free: true },
  { name: 'Social Analyzer', url: 'https://github.com/qeeqbox/social-analyzer', description: 'Find a person\'s profile across 1000+ social media sites', category: 'social', tags: ['multi-platform', 'profiling'], free: true },

  // Threat Intelligence
  { name: 'Shodan', url: 'https://www.shodan.io', description: 'Search engine for internet-connected devices — find exposed servers, cameras, ICS', category: 'threat', tags: ['iot', 'infrastructure', 'exposure'], free: false },
  { name: 'GreyNoise', url: 'https://www.greynoise.io', description: 'Identify internet scanners, bots, and malicious IP behavior', category: 'threat', tags: ['ip', 'scanner', 'noise'], free: true },
  { name: 'AbuseIPDB', url: 'https://www.abuseipdb.com', description: 'IP address reputation database for abuse detection', category: 'threat', tags: ['ip', 'abuse', 'reputation'], free: true },
  { name: 'VirusTotal', url: 'https://www.virustotal.com', description: 'Analyze files, URLs, domains for malware and suspicious activity', category: 'threat', tags: ['malware', 'analysis', 'scanning'], free: true },
  { name: 'ONYPHE', url: 'https://www.onyphe.io', description: 'Cyber defense search engine indexing exposed assets', category: 'threat', tags: ['attack-surface', 'exposure'], free: false },
  { name: 'AlienVault OTX', url: 'https://otx.alienvault.com', description: 'Open threat exchange with community-sourced IoCs', category: 'threat', tags: ['ioc', 'community', 'threat-feed'], free: true },
  { name: 'MalwareBazaar', url: 'https://bazaar.abuse.ch', description: 'Search and download confirmed malware samples by hash', category: 'threat', tags: ['malware', 'samples', 'hash'], free: true },
  { name: 'Censys', url: 'https://search.censys.io', description: 'Internet-wide scanning for hosts, certificates, and services', category: 'threat', tags: ['certificates', 'scanning', 'tls'], free: true },

  // Geospatial
  { name: 'Google Earth', url: 'https://earth.google.com', description: 'Satellite imagery with historical timeline', category: 'geo', tags: ['satellite', 'historical', 'imagery'], free: true },
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
  { name: 'Google Reverse Image', url: 'https://images.google.com', description: 'Reverse image search to find original sources', category: 'imagery', tags: ['reverse-image', 'verification'], free: true },
  { name: 'TinEye', url: 'https://tineye.com', description: 'Reverse image search engine with modification detection', category: 'imagery', tags: ['reverse-image', 'forensics'], free: true },
  { name: 'FotoForensics', url: 'https://fotoforensics.com', description: 'Image forensics — ELA, metadata, and manipulation detection', category: 'imagery', tags: ['forensics', 'manipulation', 'exif'], free: true },
  { name: 'InVID/WeVerify', url: 'https://www.invid-project.eu/tools-and-services/invid-verification-plugin/', description: 'Video verification toolkit — keyframe extraction, reverse search', category: 'imagery', tags: ['video', 'verification', 'deepfake'], free: true },
  { name: 'ExifTool', url: 'https://exiftool.org', description: 'Read and write metadata in image, audio, and video files', category: 'imagery', tags: ['metadata', 'exif', 'forensics'], free: true },

  // People Search
  { name: 'Pipl', url: 'https://pipl.com', description: 'People search engine with identity resolution', category: 'people', tags: ['identity', 'search', 'records'], free: false },
  { name: 'That\'s Them', url: 'https://thatsthem.com', description: 'Free people search — address, phone, email lookups', category: 'people', tags: ['address', 'phone', 'lookup'], free: true },
  { name: 'Hunter.io', url: 'https://hunter.io', description: 'Find professional email addresses by company domain', category: 'people', tags: ['email', 'company', 'b2b'], free: true },
  { name: 'Epieos', url: 'https://epieos.com', description: 'Find accounts linked to an email address or phone number', category: 'people', tags: ['email', 'phone', 'accounts'], free: true },

  // Username OSINT
  { name: 'Sherlock', url: 'https://github.com/sherlock-project/sherlock', description: 'Search for a username across 400+ social networks', category: 'username', tags: ['multi-platform', 'github', 'cli'], free: true },
  { name: 'WhatsMyName', url: 'https://whatsmyname.app', description: 'Username enumeration across 500+ websites', category: 'username', tags: ['enumeration', 'web'], free: true },
  { name: 'Maigret', url: 'https://github.com/soxoj/maigret', description: 'Sherlock-like username search with profile parsing', category: 'username', tags: ['username', 'profiling', 'cli'], free: true },
  { name: 'UserSearch.org', url: 'https://usersearch.org', description: 'Find people by username across social, dating, and forum sites', category: 'username', tags: ['username', 'web-based'], free: true },

  // Documents & Leaks
  { name: 'DocumentCloud', url: 'https://www.documentcloud.org', description: 'Search and analyze uploaded documents and primary sources', category: 'documents', tags: ['documents', 'primary-sources'], free: true },
  { name: 'OCCRP Aleph', url: 'https://aleph.occrp.org', description: 'Search 1B+ records from corporate registries and leaks', category: 'documents', tags: ['leaks', 'corporate', 'investigation'], free: true },
  { name: 'Offshore Leaks DB', url: 'https://offshoreleaks.icij.org', description: 'ICIJ database of offshore companies from Panama/Pandora Papers', category: 'documents', tags: ['offshore', 'panama-papers', 'corporate'], free: true },
  { name: 'Court Listener', url: 'https://www.courtlistener.com', description: 'US court opinions, oral arguments, and PACER documents', category: 'documents', tags: ['legal', 'court', 'us'], free: true },

  // Fact Checking
  { name: 'Bellingcat', url: 'https://www.bellingcat.com/resources/', description: 'OSINT investigation guides and methodology from Bellingcat', category: 'factcheck', tags: ['methodology', 'guides', 'investigation'], free: true },
  { name: 'Snopes', url: 'https://www.snopes.com', description: 'Fact-checking and debunking misinformation', category: 'factcheck', tags: ['factcheck', 'debunk'], free: true },
  { name: 'Google Fact Check Explorer', url: 'https://toolbox.google.com/factcheck/explorer', description: 'Search fact checks from around the world', category: 'factcheck', tags: ['factcheck', 'google', 'claims'], free: true },
  { name: 'ACLED', url: 'https://acleddata.com', description: 'Armed conflict location and event data for 200+ countries', category: 'factcheck', tags: ['conflict', 'data', 'events'], free: true },
];

export class OsintToolkitPanel extends Panel {
  private searchQuery = '';
  private activeCategory = 'all';

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
    const searchBar = document.createElement('div');
    searchBar.className = 'otp-search';
    searchBar.innerHTML = `<input type="text" class="otp-search-input" id="otpSearch" placeholder="Search tools..." spellcheck="false" />`;
    content.appendChild(searchBar);

    // Category filter tabs
    const tabs = document.createElement('div');
    tabs.className = 'panel-tabs otp-tabs';
    tabs.innerHTML = CATEGORIES.map(c =>
      `<button class="panel-tab${c.id === 'all' ? ' active' : ''}" data-cat="${c.id}">${c.icon} ${c.label}</button>`
    ).join('');
    content.appendChild(tabs);

    // Tools list
    const list = document.createElement('div');
    list.className = 'otp-list';
    list.id = 'otpList';
    content.appendChild(list);

    // Search handler
    const searchInput = searchBar.querySelector('#otpSearch') as HTMLInputElement;
    searchInput.addEventListener('input', () => {
      this.searchQuery = searchInput.value.toLowerCase().trim();
      this.renderTools();
    });

    // Tab handler
    tabs.addEventListener('click', (e) => {
      const btn = (e.target as HTMLElement).closest('.panel-tab') as HTMLElement;
      if (!btn) return;
      tabs.querySelectorAll('.panel-tab').forEach(t => t.classList.remove('active'));
      btn.classList.add('active');
      this.activeCategory = btn.dataset.cat || 'all';
      this.renderTools();
    });

    this.renderTools();
  }

  private renderTools(): void {
    const list = this.content.querySelector('#otpList');
    if (!list) return;

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
      list.innerHTML = '<div class="otp-empty">No tools match your search.</div>';
      return;
    }

    list.innerHTML = filtered.map(t => {
      const catObj = CATEGORIES.find(c => c.id === t.category);
      const icon = catObj?.icon || '🔧';
      return `<a href="${this.escHtml(t.url)}" target="_blank" rel="noopener noreferrer" class="otp-tool">
        <div class="otp-tool-header">
          <span class="otp-tool-icon">${icon}</span>
          <span class="otp-tool-name">${this.escHtml(t.name)}</span>
          ${t.free ? '<span class="otp-tag otp-free">FREE</span>' : '<span class="otp-tag otp-paid">PAID</span>'}
        </div>
        <div class="otp-tool-desc">${this.escHtml(t.description)}</div>
        <div class="otp-tool-tags">${t.tags.map(tag => `<span class="otp-tool-tag">${tag}</span>`).join('')}</div>
      </a>`;
    }).join('');
  }

  private escHtml(s: string): string {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
}
