// Server only. Never copy the service-role key into the static application.
export function createDeleteAccountHandler({ url, serviceKey, allowedOrigins, fetcher = fetch }) {
  return async request => {
    const origin = request.headers.get('origin');
    const allowed = origin && allowedOrigins.includes(origin);
    const headers = { 'Content-Type': 'application/json', 'Vary': 'Origin',
      ...(allowed ? { 'Access-Control-Allow-Origin': origin, 'Access-Control-Allow-Headers': 'authorization, apikey, content-type',
        'Access-Control-Allow-Methods': 'POST, OPTIONS' } : {}) };
    const reply = (status, message) => new Response(JSON.stringify(message), { status, headers });
    if (origin && !allowed) return reply(403, { error: 'Origine non consentita.' });
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers });
    if (request.method !== 'POST') return reply(405, { error: 'Metodo non consentito.' });
    if (!url || !serviceKey) return reply(503, { error: 'Servizio non disponibile. Contatta il supporto.' });
    const authorization = request.headers.get('authorization') || '';
    if (!/^Bearer \S+$/i.test(authorization)) return reply(401, { error: 'Accedi di nuovo.' });
    let body;
    try { body = await request.json(); } catch { return reply(400, { error: 'Richiesta non valida.' }); }
    if (body.confirmation !== 'DELETE_ACCOUNT') return reply(400, { error: 'Conferma mancante.' });
    try {
      // Identity comes only from Auth, never from a user ID supplied by the caller.
      const verification = await fetcher(`${url}/auth/v1/user`, { headers: { apikey: serviceKey, Authorization: authorization } });
      if (!verification.ok) return reply(401, { error: 'Sessione non valida. Accedi di nuovo.' });
      const user = await verification.json();
      if (!/^[0-9a-f-]{36}$/i.test(user.id || '')) return reply(401, { error: 'Account non valido.' });
      const adminHeaders = { apikey: serviceKey, Authorization: `Bearer ${serviceKey}`, 'Content-Type': 'application/json' };
      // App avatars are flat files under the authenticated user's folder.
      // Repeat page zero after removal to avoid skipping objects while deleting.
      for (let batch = 0; ; batch++) {
        if (batch > 1000) throw new Error('Troppi oggetti da eliminare. Contatta il supporto.');
        const listing = await fetcher(`${url}/storage/v1/object/list/smokelog-avatars`, {
          method: 'POST', headers: adminHeaders, body: JSON.stringify({ prefix: user.id, limit: 100, offset: 0 })
        });
        if (!listing.ok) throw new Error('Rimozione foto non riuscita. Riprova; l’account è ancora attivo.');
        const files = await listing.json();
        if (!Array.isArray(files)) throw new Error('Risposta archivio non valida.');
        if (!files.length) break;
        if (files.some(file => !file.id || typeof file.name !== 'string' || file.name.includes('/') || file.name.includes('..'))) {
          throw new Error('Archivio foto da verificare. Contatta il supporto.');
        }
        const removal = await fetcher(`${url}/storage/v1/object/smokelog-avatars`, {
          method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ prefixes: files.map(file => `${user.id}/${file.name}`) })
        });
        if (!removal.ok) throw new Error('Rimozione foto non riuscita. Riprova; l’account è ancora attivo.');
      }
      const deletion = await fetcher(`${url}/auth/v1/admin/users/${user.id}`, {
        method: 'DELETE', headers: adminHeaders, body: JSON.stringify({ should_soft_delete: false })
      });
      if (!deletion.ok) throw new Error('Eliminazione account non completata. Riprova o contatta il supporto.');
      // Foreign keys ON DELETE CASCADE remove events, purchases and categories.
      return reply(200, { deleted: true });
    } catch (error) {
      return reply(503, { error: error instanceof TypeError ? 'Connessione al servizio non disponibile. Riprova.' : error.message });
    }
  };
}
