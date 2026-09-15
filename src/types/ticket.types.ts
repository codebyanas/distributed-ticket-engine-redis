export type SeatState = 'AVAILABLE' | 'HELD' | 'SOLD';

export interface SeatingMapSeat {
	id: string;
	section: string;
	row: string;
	number: string;
	status: SeatState;
}

export interface SeatingMap {
	eventId: string;
	eventName: string;
	startsAt: string;
	seats: SeatingMapSeat[];
}

export type SeatingMapMode = 'direct' | 'redis-protected';

export interface SeatingMapExecutionMeta {
	mode: SeatingMapMode;
	cacheHit: boolean;
	lockAcquired: boolean;
	waitedForLock: boolean;
	databaseLoaded: boolean;
	durationMs: number;
}

export interface SeatingMapResult {
	map: SeatingMap;
	meta: SeatingMapExecutionMeta;
}
