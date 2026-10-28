import { createDeleteAccountHandler } from './handler.mjs';

Deno.serve(createDeleteAccountHandler({
  url: Deno.env.get('SUPABASE_URL'),
  serviceKey: Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  allowedOrigins: (Deno.env.get('SMOKELOG_ALLOWED_ORIGINS') || '').split(',').map(value => value.trim()).filter(Boolean)
}));
