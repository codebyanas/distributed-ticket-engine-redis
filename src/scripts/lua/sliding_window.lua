local key = KEYS[1]
local now = tonumber(ARGV[1])
local window_start = now - tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local member = ARGV[4]
local ttl_seconds = tonumber(ARGV[5])

redis.call('ZREMRANGEBYSCORE', key, 0, window_start)
redis.call('ZADD', key, now, member)
redis.call('EXPIRE', key, ttl_seconds)

local request_count = redis.call('ZCARD', key)
local allowed = request_count <= limit and 1 or 0
local remaining = math.max(limit - request_count, 0)
local reset_at = now + tonumber(ARGV[2])

return { allowed, remaining, reset_at, request_count }
