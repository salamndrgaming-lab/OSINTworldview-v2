// src/services/flightAnomalyService.ts
// FIXES:
//   - TS6133 / TS2307: removed unused 'axios' import (axios is not in package.json)
//   - TS18048: 'lastSeen' is possibly undefined (noUncheckedIndexedAccess)
//     → guard previousFlights.at(-1) or explicit length check
//   - TS2345 (lines 81, 106): number[][] not assignable to [[number,number],[number,number]]
//     → CONFLICT_ZONES bounds typed as [[number, number], [number, number]][]
//   - TS2532 (line 140): recentFlights[i] / recentFlights[i-1] possibly undefined
//     → guard both elements before use

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

// FIX TS2345: explicit tuple type so isPointInBounds receives the right shape
interface ConflictZone {
  name: string;
  bounds: [[number, number], [number, number]];
}

export class FlightAnomalyService {
  // FIX TS2345: typed as ConflictZone[] so bounds literals satisfy the tuple constraint
  private static CONFLICT_ZONES: ConflictZone[] = [
    { name: 'Ukraine', bounds: [[49.0, 22.0], [52.5, 40.0]] },
    { name: 'Syria',   bounds: [[32.0, 35.0], [37.5, 42.5]] },
  ];

  static async detectAnomalies(
    currentFlights: FlightData[],
    historicalData: FlightData[],
    ciiScores: Map<string, number>
  ): Promise<AnomalyDetection[]> {

    const anomalies: AnomalyDetection[] = [];

    for (const flight of currentFlights) {
      const ghostFleetAnomaly = this.detectGhostFleet(flight, historicalData);
      if (ghostFleetAnomaly) {
        anomalies.push(ghostFleetAnomaly);
      }

      const conflictAnomaly = this.detectConflictZoneProximity(flight, ciiScores);
      if (conflictAnomaly) {
        anomalies.push(conflictAnomaly);
      }

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

    const previousFlights = historical.filter(f => f.icao24 === flight.icao24);

    if (previousFlights.length < 2) return null;

    // FIX TS18048: previousFlights[previousFlights.length - 1] is FlightData|undefined
    // under noUncheckedIndexedAccess. Use Array.prototype.at(-1) with a guard.
    const lastSeenFlight = previousFlights.at(-1);
    if (!lastSeenFlight) return null;

    const timeSinceLastSeen = flight.lastSeen - lastSeenFlight.lastSeen;

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
        const ciiScore = ciiScores.get(zone.name) ?? 0;

        if (ciiScore > 0.7) {
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

    const recentFlights = historical
      .filter(f => f.icao24 === flight.icao24)
      .filter(f => Date.now() - f.lastSeen < 7200000);

    if (recentFlights.length > 3) {
      const gaps: number[] = [];

      for (let i = 1; i < recentFlights.length; i++) {
        // FIX TS2532: noUncheckedIndexedAccess — guard both elements
        const curr = recentFlights[i];
        const prev = recentFlights[i - 1];
        if (curr === undefined || prev === undefined) continue;
        gaps.push(curr.lastSeen - prev.lastSeen);
      }

      if (gaps.length === 0) return null;

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
