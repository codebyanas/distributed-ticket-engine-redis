import type { Redis } from 'ioredis';
import { readFile } from 'node:fs/promises';

export type LuaScriptName = 'slidingWindow';

const scriptSources: Readonly<Record<LuaScriptName, URL>> = {
	slidingWindow: new URL('./lua/sliding_window.lua', import.meta.url),
};

const scriptDigests = new Map<LuaScriptName, string>();

/**
 * Loads the Phase 1 Lua scripts into Redis and stores their SHA1 digests.
 *
 * @param client - Connected Redis client used for script registration.
 * @returns Promise resolving after all configured scripts are loaded.
 * @concurrency Impact: SCRIPT LOAD is idempotent; the shared digest registry avoids sending script bodies per request.
 * @complexity Time: O(S) for script source size S | Space: O(S)
 */
export const loadLuaScripts = async (client: Redis): Promise<void> => {
	for (const [name, sourceUrl] of Object.entries(scriptSources) as [LuaScriptName, URL][]) {
		const source = await readFile(sourceUrl, 'utf8');
		const digest = await client.script('LOAD', source);
		if (typeof digest !== 'string') {
			throw new Error(`Redis returned an invalid digest for Lua script: ${name}`);
		}
		scriptDigests.set(name, digest);
	}
};

/**
 * Returns the registered digest for a named Lua script.
 *
 * @param name - Registered script identifier.
 * @returns SHA1 digest required by EVALSHA.
 * @concurrency Impact: Reads immutable startup state and performs no Redis mutation.
 * @complexity Time: O(1) | Space: O(1)
 */
export const getLuaScriptDigest = (name: LuaScriptName): string => {
	const digest = scriptDigests.get(name);
	if (digest === undefined) {
		throw new Error(`Lua script has not been loaded: ${name}`);
	}
	return digest;
};
