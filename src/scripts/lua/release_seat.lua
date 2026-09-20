local key = KEYS[1]
local user_id = ARGV[1]
local hold_id = ARGV[2]
local current_value = redis.call('GET', key)

if current_value == false then
  return 0
end

local parsed = cjson.decode(current_value)
if parsed and parsed.status == 'HELD' and parsed.userId == user_id and parsed.holdId == hold_id then
  return redis.call('DEL', key)
end

return 0