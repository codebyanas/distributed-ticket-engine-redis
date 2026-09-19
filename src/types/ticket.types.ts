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

export interface HoldSeatRequest {
	eventId: string;
	seatId: string;
	userId: string;
}

export interface SeatHoldRecord {
	holdId: string;
	eventId: string;
	seatId: string;
	userId: string;
	status: 'HELD';
	expiresAt: string;
}

export interface HoldSeatSuccessResponse {
	status: 'success';
	statusCode: 200;
	data: SeatHoldRecord;
}

export interface HoldSeatConflictResponse {
	status: 'fail';
	statusCode: 409;
	message: string;
}

export type HoldSeatResponse = HoldSeatSuccessResponse | HoldSeatConflictResponse;
