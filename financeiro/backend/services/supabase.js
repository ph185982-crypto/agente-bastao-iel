const { createClient } = require('@supabase/supabase-js');

let _client = null;

function getClient() {
  if (!_client) {
    if (!process.env.SUPABASE_URL || !process.env.SUPABASE_SERVICE_KEY) {
      throw new Error('SUPABASE_URL e SUPABASE_SERVICE_KEY são obrigatórios');
    }
    _client = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
  }
  return _client;
}

module.exports = new Proxy({}, {
  get(_, prop) {
    return (...args) => getClient()[prop](...args);
  },
});
