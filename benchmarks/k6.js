import http from 'k6/http';
import { check } from 'k6';

const baseUrl = __ENV.BENCHMARK_BASE_URL || 'http://localhost:5000';
const eventId = __ENV.BENCHMARK_EVENT_ID || 'phase-2-demo-event';
const seatId = __ENV.BENCHMARK_SEAT_ID || `${eventId}-1-1-1`;
const scenario = __ENV.BENCHMARK_SCENARIO || 'hold-hotspot';

export const options = {
  scenarios: {
    phase7: {
      executor: 'ramping-arrival-rate',
      startRate: 100,
      timeUnit: '1s',
      preAllocatedVUs: Number(__ENV.BENCHMARK_PREALLOCATED_VUS || 500),
      maxVUs: Number(__ENV.BENCHMARK_MAX_VUS || 5000),
      stages: [
        { target: 1000, duration: '30s' },
        { target: 5000, duration: '60s' },
        { target: 20000, duration: '120s' },
        { target: 0, duration: '30s' },
      ],
    },
  },
  thresholds: {
    http_req_duration: ['p(95)<10', 'p(99)<10'],
  },
};

export default function () {
  if (scenario === 'geo-search') {
    const response = http.get(`${baseUrl}/api/v1/events/search/geo?lat=24.8607&lng=67.0011&radiusKm=10&limit=20`);
    check(response, { 'geo search is successful': (value) => value.status === 200 });
    return;
  }

  const path = scenario === 'orders' ? '/api/v1/tickets/orders' : '/api/v1/tickets/hold';
  const response = http.post(
    `${baseUrl}${path}`,
    JSON.stringify({ eventId, seatId, userId: `k6-user-${__VU}` }),
    { headers: { 'Content-Type': 'application/json' } },
  );
  check(response, {
    'request is accepted or expected contention': (value) => value.status === 200 || value.status === 202 || value.status === 409,
  });
}