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
