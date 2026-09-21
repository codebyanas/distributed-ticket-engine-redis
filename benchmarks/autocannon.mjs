import autocannon from 'autocannon';

const baseUrl = process.env.BENCHMARK_BASE_URL ?? 'http://localhost:5000';
const scenario = process.argv[2] ?? 'hold-hotspot';
const eventId = process.env.BENCHMARK_EVENT_ID ?? 'phase-2-demo-event';
const seatId = process.env.BENCHMARK_SEAT_ID ?? `${eventId}-1-1-1`;
const latitude = process.env.BENCHMARK_LATITUDE ?? '24.8607';
const longitude = process.env.BENCHMARK_LONGITUDE ?? '67.0011';
const connections = Number(process.env.BENCHMARK_CONNECTIONS ?? 1000);
const duration = Number(process.env.BENCHMARK_DURATION_SECONDS ?? 30);
const targetRps = Number(process.env.BENCHMARK_TARGET_RPS ?? 20000);

const jsonBody = (value) => JSON.stringify(value);

const scenarios = {
	'hold-hotspot': {
		method: 'POST',
		path: '/api/v1/tickets/hold',
		body: jsonBody({ eventId, seatId, userId: 'benchmark-hotspot-user' }),
	},
	'hold-pool': {
		method: 'POST',
		path: '/api/v1/tickets/hold',
		body: jsonBody({ eventId, seatId, userId: 'benchmark-pool-user' }),
	},
	'geo-search': {
		method: 'GET',
		path: `/api/v1/events/search/geo?lat=${latitude}&lng=${longitude}&radiusKm=10&limit=20`,
	},
	'orders': {
		method: 'POST',
		path: '/api/v1/tickets/orders',
		body: jsonBody({ eventId, seatId, userId: 'benchmark-order-user' }),
	},
};

const selected = scenarios[scenario];
if (selected === undefined) {
	throw new Error(`Unknown benchmark scenario: ${scenario}`);
}

const headers = {
	'x-benchmark-bypass': 'true',
	'content-type': 'application/json',
};

const result = await autocannon({
	url: `${baseUrl}${selected.path}`,
	method: selected.method,
	body: selected.body,
	headers,
	connections,
	duration,
	overallRate: targetRps,
});

process.stdout.write(JSON.stringify({ scenario, targetRps, result }, null, 2));