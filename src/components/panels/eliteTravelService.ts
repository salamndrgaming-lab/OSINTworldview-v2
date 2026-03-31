// src/services/eliteTravelService.ts
// FIXES:
//   - Replaced axios with fetch (axios is not in package.json)
//   - Fixed TS18048: array elements typed as TravelEvent|undefined (noUncheckedIndexedAccess)
//     → added null guards before using event1/event2
//   - Fixed TS2345: VIP_DATABASE.find() returns ElitePerson|undefined
//     → use non-null assertion only after confirming find won't miss (VIP_DATABASE is source
//     of truth for personId), or filter before use
//   - Removed unused 'location' parameter (TS6133, noUnusedLocals)
//   - Removed unused 'country' parameter (TS6133, noUnusedParameters)
//     → prefixed with _ to satisfy noUnusedParameters without removing the signature

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
    // 500+ high-profile individuals
    { id: 'vip1', name: 'Example CEO', title: 'CEO of MegaCorp', category: 'ceo', knownAircraft: ['N123AB'], significance: 8 },
    // ... more entries
  ];

  static async trackFlights(): Promise<TravelEvent[]> {
    const events: TravelEvent[] = [];

    for (const vip of this.VIP_DATABASE) {
      for (const aircraft of vip.knownAircraft) {
        try {
          const flightData = await this.fetchFlightData(aircraft);

          if (flightData && flightData.flight) {
            const event: TravelEvent = {
              personId: vip.id,
              personName: vip.name,
              aircraft,
              origin: flightData.origin,
              destination: flightData.destination,
              departureTime: flightData.departureTime,
              arrivalTime: flightData.estimatedArrival,
              geopoliticalContext: await this.getGeopoliticalContext(
                flightData.destination.country
              ),
              significance: vip.significance,
            };

            events.push(event);
          }
        } catch (error) {
          console.error(`Error tracking ${aircraft}:`, error);
        }
      }
    }

    return events;
  }

  static async detectMeetings(
    events: TravelEvent[],
    timeWindow: number = 86400000 // 24 hours
  ): Promise<MeetingAlert[]> {

    const alerts: MeetingAlert[] = [];

    const locationGroups = new Map<string, TravelEvent[]>();

    events.forEach(event => {
      const key = `${event.destination.city}_${event.destination.country}`;
      if (!locationGroups.has(key)) {
        locationGroups.set(key, []);
      }
      locationGroups.get(key)!.push(event);
    });

    for (const locationEvents of locationGroups.values()) {
      // FIX: unused loop variable 'location' removed — iterate values() only
      if (locationEvents.length < 2) continue;

      for (let i = 0; i < locationEvents.length; i++) {
        for (let j = i + 1; j < locationEvents.length; j++) {
          // FIX TS18048: noUncheckedIndexedAccess makes these TravelEvent|undefined
          const event1: TravelEvent | undefined = locationEvents[i];
          const event2: TravelEvent | undefined = locationEvents[j];

          // Guard before use
          if (!event1 || !event2) continue;

          const overlap = this.checkTimeOverlap(
            event1.arrivalTime,
            event1.arrivalTime + timeWindow,
            event2.arrivalTime,
            event2.arrivalTime + timeWindow
          );

          if (overlap) {
            // FIX TS2345: find() returns ElitePerson|undefined
            // Safe: personId originates from VIP_DATABASE itself, so find will always match.
            // Using nullish fallback to satisfy strict null checks without crashing.
            const vip1 = this.VIP_DATABASE.find(v => v.id === event1.personId);
            const vip2 = this.VIP_DATABASE.find(v => v.id === event2.personId);

            if (!vip1 || !vip2) continue;

            alerts.push({
              participants: [vip1, vip2],
              location: event1.destination,
              timeWindow: {
                start: Math.max(event1.arrivalTime, event2.arrivalTime),
                end: Math.min(
                  event1.arrivalTime + timeWindow,
                  event2.arrivalTime + timeWindow
                ),
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
    // FIX: replaced axios with fetch (axios is not in package.json)
    const url = new URL('https://opensky-network.org/api/states/all');
    url.searchParams.set('icao24', aircraft.toLowerCase());

    const response = await fetch(url.toString());
    if (!response.ok) {
      throw new Error(`OpenSky API error: ${response.status}`);
    }
    return response.json();
  }

  private static async getGeopoliticalContext(
    _country: string  // FIX TS6133: prefixed with _ — parameter kept for API shape
  ): Promise<string[]> {
    // Fetch current events/tensions for the country
    return []; // Implementation would fetch from news APIs
  }

  private static checkTimeOverlap(
    start1: number,
    end1: number,
    start2: number,
    end2: number
  ): boolean {
    return start1 <= end2 && start2 <= end1;
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

    if (event1.destination.city === event2.destination.city) {
      confidence += 0.3;
    }

    const timeDiff = Math.abs(event1.arrivalTime - event2.arrivalTime);
    if (timeDiff < 3600000) {
      confidence += 0.2;
    }

    return Math.min(confidence, 1.0);
  }
}
