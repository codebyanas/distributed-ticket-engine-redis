local current_token = redis.call('GET', KEYS[1])
if current_token == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0