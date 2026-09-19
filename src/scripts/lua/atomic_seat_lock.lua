local key = KEYS[1]
local user_id = ARGV[1]
local ttl_seconds = tonumber(ARGV[2])

if ttl_seconds == nil or ttl_seconds <= 0 then
  return 0
end

local current_value = redis.call('GET', key)
if current_value == false then
  local payload = cjson.encode({
    status = 'HELD',
    userId = user_id,
    createdAt = tonumber(redis.call('TIME')[1]),
    expiresAt = tonumber(redis.call('TIME')[1]) + ttl_seconds
  })

  redis.call('SET', key, payload, 'EX', ttl_seconds)
  return 1
end

local parsed = cjson.decode(current_value)
if parsed and (parsed.status == 'HELD' or parsed.status == 'SOLD') then
  return 0
end

return 0
