const EventEmitter = require('events');

class DiscoveryService extends EventEmitter {
  constructor() {
    super();
    this.bonjour = null;
    this.browser = null;
    this.discoveredServers = [];
    this.isRunning = false;
  }

  startBrowsing() {
    try {
      const Bonjour = require('bonjour-service').Bonjour;
      this.bonjour = new Bonjour();
      
      this.browser = this.bonjour.find({ type: 'vsteps' }, (service) => {
        console.log('Found VSteps service:', service);
        
        const serverUrl = `http://${service.host}:${service.port}`;
        
        if (!this.discoveredServers.includes(serverUrl)) {
          this.discoveredServers.push(serverUrl);
          this.emit('server-found', serverUrl);
        }
      });

      this.browser.on('down', (service) => {
        const serverUrl = `http://${service.host}:${service.port}`;
        this.discoveredServers = this.discoveredServers.filter(s => s !== serverUrl);
        this.emit('server-lost', serverUrl);
      });

      this.isRunning = true;
      console.log('mDNS discovery started, looking for VSteps servers...');
      
    } catch (err) {
      console.error('Failed to start mDNS discovery:', err.message);
      console.log('Automatic discovery disabled - use manual connection');
    }
  }

  stop() {
    if (this.browser) {
      this.browser.stop();
      this.browser = null;
    }
    if (this.bonjour) {
      this.bonjour.destroy();
      this.bonjour = null;
    }
    this.isRunning = false;
    this.discoveredServers = [];
  }

  getDiscoveredServers() {
    return [...this.discoveredServers];
  }

  isDiscoveryRunning() {
    return this.isRunning;
  }
}

module.exports = { DiscoveryService };
