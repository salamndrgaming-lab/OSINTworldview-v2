import axios from 'axios';

interface FlightData {
  icao24: string;
  callsign: string;
  latitude: number;
  longitude: number;
  altitude: number;
  velocity: number;
  track: number;
  lastSeen: number;
  civil: boolean;
}

interface AnomalyDetection {
  flightId: string;
  anomalyType: 'ghost_fleet' | 'unusual_route' | 'transponder_off' | 'conflict_zone';
  severity: 'low' | 'medium' | 'high' | 'critical';
  details: string;
  location: { lat: number; lng: number };
  ciiCorrelation: number;
  timestamp: number;
}

export class FlightAnomalyService {
  private static CONFLICT_ZONES = [
    // Define conflict zone polygons
    { name: 'Ukraine', bounds: [[49.0, 22.0], [52.5, 40.0]] },
    { name: 'Syria', bounds: [[32.0, 35.0], [37.5, 42.5]] },
    // etc.
  ];
  
  static async detectAnomalies(
    currentFlights: FlightData[],
    historicalData: FlightData[],
    ciiScores: Map<string, number>
  ): Promise<AnomalyDetection[]> {
    
    const anomalies: AnomalyDetection[] = [];
    
    for (const flight of currentFlights) {
      // Check for ghost fleet pattern
      const ghostFleetAnomaly = this.detectGhostFleet(flight, historicalData);
      if (ghostFleetAnomaly) {
        anomalies.push(ghostFleetAnomaly);
      }
      
      // Check for conflict zone proximity
      const conflictAnomaly = this.detectConflictZoneProximity(flight, ciiScores);
      if (conflictAnomaly) {
        anomalies.push(conflictAnomaly);
      }
      
      // Check for transponder behavior
      const transponderAnomaly = this.detectTransponderAnomaly(flight, historicalData);
      if (transponderAnomaly) {
        anomalies.push(transponderAnomaly);
      }
    }
    
    return anomalies;
  }
  
  private static detectGhostFleet(
    flight: FlightData,
    historical: FlightData[]
  ): AnomalyDetection | null {
    
    // Find previous appearances of this aircraft
    const previousFlights = historical.filter(f => f.icao24 === flight.icao24);
    
    if (previousFlights.length < 2) return null;
    
    // Check for sudden disappearance near conflict zones
    const lastSeen = previousFlights[previousFlights.length - 1];
    const timeSinceLastSeen = flight.lastSeen - lastSeen.lastSeen;
    
    // If aircraft reappeared after >24h near a conflict zone
    if (timeSinceLastSeen > 86400000) {
      const nearConflictZone = this.CONFLICT_ZONES.some(zone =>
        this.isPointInBounds(flight.latitude, flight.longitude, zone.bounds)
      );
      
      if (nearConflictZone) {
        return {
          flightId: flight.icao24,
          anomalyType: 'ghost_fleet',
          severity: 'high',
          details: `Civil aircraft went dark for ${(timeSinceLastSeen / 3600000).toFixed(1)}h near conflict zone`,
          location: { lat: flight.latitude, lng: flight.longitude },
          ciiCorrelation: 0,
          timestamp: Date.now(),
        };
      }
    }
    
    return null;
  }
  
  private static detectConflictZoneProximity(
    flight: FlightData,
    ciiScores: Map<string, number>
  ): AnomalyDetection | null {
    
    for (const zone of this.CONFLICT_ZONES) {
      if (this.isPointInBounds(flight.latitude, flight.longitude, zone.bounds)) {
        const ciiScore = ciiScores.get(zone.name) || 0;
        
        if (ciiScore > 0.7) { // High instability
          return {
            flightId: flight.icao24,
            anomalyType: 'conflict_zone',
            severity: 'critical',
            details: `Flight in high-CII conflict zone: ${zone.name}`,
            location: { lat: flight.latitude, lng: flight.longitude },
            ciiCorrelation: ciiScore,
            timestamp: Date.now(),
          };
        }
      }
    }
    
    return null;
  }
  
  private static detectTransponderAnomaly(
    flight: FlightData,
    historical: FlightData[]
  ): AnomalyDetection | null {
    
    // Check for irregular transponder behavior
    const recentFlights = historical
      .filter(f => f.icao24 === flight.icao24)
      .filter(f => Date.now() - f.lastSeen < 7200000); // Last 2 hours
    
    if (recentFlights.length > 3) {
      // Check for on/off pattern
      const gaps = [];
      for (let i = 1; i < recentFlights.length; i++) {
        gaps.push(recentFlights[i].lastSeen - recentFlights[i - 1].lastSeen);
      }
      
      const avgGap = gaps.reduce((a, b) => a + b, 0) / gaps.length;
      const hasPatternedDropouts = gaps.filter(g => g > avgGap * 2).length > 2;
      
      if (hasPatternedDropouts) {
        return {
          flightId: flight.icao24,
          anomalyType: 'transponder_off',
          severity: 'medium',
          details: 'Unusual transponder on/off pattern detected',
          location: { lat: flight.latitude, lng: flight.longitude },
          ciiCorrelation: 0,
          timestamp: Date.now(),
        };
      }
    }
    
    return null;
  }
  
  private static isPointInBounds(
    lat: number,
    lng: number,
    bounds: [[number, number], [number, number]]
  ): boolean {
    return lat >= bounds[0][0] && lat <= bounds[1][0] &&
           lng >= bounds[0][1] && lng <= bounds[1][1];
  }
}