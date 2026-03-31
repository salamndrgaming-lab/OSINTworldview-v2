// src/services/eliteTravelService.ts
// FIXES:
//   - TS2307: Cannot find module 'axios' — replaced with fetch
//   - TS6133: 'location' unused (line 93) — loop variable removed by iterating .values()
//   - TS18048: event1/event2 possibly undefined (noUncheckedIndexedAccess)
//     → explicit TravelEvent|undefined declarations + continue guard
//   - TS2345: TravelEvent|undefined not assignable to TravelEvent
//     → VIP find() result guarded before use
//   - TS6133: 'country' unused (line 143) → renamed to _country

interface ElitePerson {
  id: string;
  name: string;
  title: string;
  category: 'ceo' | 'politician' | 'diplomat' | 'military';
  knownAircraft: string[];
  significance: number;
}

interface TravelEvent {
  personId: string;
  personName: string;
  aircraft: string;
  origin: { city: string; country: string; lat: number; lng: number };
  destination: { city: string; country: string; lat: number; lng: number };
  departureTime: number;
  arrivalTime: number;
  geopoliticalContext: string[];
  significance: number;
}

interface MeetingAlert {
  participants: ElitePerson[];
  location: { city: string; country: string };
  timeWindow: { start: number; end: number };
  geopoliticalSignificance: string;
  confidence: number;
}

export class EliteTravelService {
  private static VIP_DATABASE: ElitePerson[] = [
    { id: 'vip1', name: 'Example CEO', title: 'CEO of MegaCorp', category: 'ceo', knownAircraft: ['N123AB'], significance: 8 },
  ];

  static async trackFlights(): Promise<TravelEvent[]> {
    const events: TravelEvent[] = [];

    for (const vip of this.VIP_DATABASE) {
      for (const aircraft of vip.knownAircraft) {
        try {
          const flightData = await this.fetchFlightData(aircraft);

          if (flightData?.flight) {
            events.push({
              personId: vip.id,
              personName: vip.name,
              aircraft,
              origin: flightData.origin,
              destination: flightData.destination,
              departureTime: flightData.departureTime,
              arrivalTime: flightData.estimatedArrival,
              geopoliticalContext: await this.getGeopoliticalContext(flightData.destination.country),
              significance: vip.significance,
            });
          }
        } catch (err) {
          console.error(`Error tracking ${aircraft}:`, err);
        }
      }
    }

    return events;
  }

  static async detectMeetings(
    events: TravelEvent[],
    timeWindow: number = 86400000
  ): Promise<MeetingAlert[]> {
    const alerts: MeetingAlert[] = [];
    const locationGroups = new Map<string, TravelEvent[]>();

    events.forEach(event => {
      const key = `${event.destination.city}_${event.destination.country}`;
      if (!locationGroups.has(key)) locationGroups.set(key, []);
      locationGroups.get(key)!.push(event);
    });

    // FIX TS6133: removed unused 'location' binding — iterate .values() only
    for (const locationEvents of locationGroups.values()) {
      if (locationEvents.length < 2) continue;

      for (let i = 0; i < locationEvents.length; i++) {
        for (let j = i + 1; j < locationEvents.length; j++) {
          // FIX TS18048: noUncheckedIndexedAccess — array[n] is TravelEvent|undefined
          const event1: TravelEvent | undefined = locationEvents[i];
          const event2: TravelEvent | undefined = locationEvents[j];
          if (!event1 || !event2) continue;

          const overlap = this.checkTimeOverlap(
            event1.arrivalTime,
            event1.arrivalTime + timeWindow,
            event2.arrivalTime,
            event2.arrivalTime + timeWindow
          );

          if (overlap) {
            // FIX TS2345: find() returns ElitePerson|undefined — guard before use
            const vip1 = this.VIP_DATABASE.find(v => v.id === event1.personId);
            const vip2 = this.VIP_DATABASE.find(v => v.id === event2.personId);
            if (!vip1 || !vip2) continue;

            alerts.push({
              participants: [vip1, vip2],
              location: event1.destination,
              timeWindow: {
                start: Math.max(event1.arrivalTime, event2.arrivalTime),
                end: Math.min(event1.arrivalTime + timeWindow, event2.arrivalTime + timeWindow),
              },
              geopoliticalSignificance: this.analyzeSignificance(vip1, vip2, event1.destination),
              confidence: this.calculateConfidence(event1, event2),
            });
          }
        }
      }
    }

    return alerts;
  }

  private static async fetchFlightData(aircraft: string): Promise<any> {
    const url = new URL('https://opensky-network.org/api/states/all');
    url.searchParams.set('icao24', aircraft.toLowerCase());
    const res = await fetch(url.toString());
    if (!res.ok) throw new Error(`OpenSky error: ${res.status}`);
    return res.json();
  }

  // FIX TS6133: renamed 'country' → '_country' (intentionally unused parameter)
  private static async getGeopoliticalContext(_country: string): Promise<string[]> {
    return [];
  }

  private static checkTimeOverlap(s1: number, e1: number, s2: number, e2: number): boolean {
    return s1 <= e2 && s2 <= e1;
  }

  private static analyzeSignificance(
    vip1: ElitePerson,
    vip2: ElitePerson,
    location: { city: string; country: string }
  ): string {
    if (vip1.category === 'politician' && vip2.category === 'ceo') {
      return `Potential business-government meeting in ${location.country}`;
    }
    return 'Unknown significance';
  }

  private static calculateConfidence(event1: TravelEvent, event2: TravelEvent): number {
    let confidence = 0.5;
    if (event1.destination.city === event2.destination.city) confidence += 0.3;
    if (Math.abs(event1.arrivalTime - event2.arrivalTime) < 3600000) confidence += 0.2;
    return Math.min(confidence, 1.0);
  }
}
