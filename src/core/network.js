// Bound the entire response read, not just the arrival of HTTP headers.
async function cloudFetch(url, options = {}) {
  const controller = new AbortController();
  const cancel = () => controller.abort();
  if (options.signal?.aborted) controller.abort();
  options.signal?.addEventListener('abort', cancel, { once: true });
  const timer = setTimeout(cancel, 15000);
  try {
    const response = await fetch(url, { ...options, signal: controller.signal });
    const body = await response.text();
    return { ok: response.ok, status: response.status, headers: response.headers,
      text: async () => body, json: async () => JSON.parse(body) };
  } catch (error) {
    if (controller.signal.aborted) throw new Error('Connessione interrotta o troppo lenta. I dati restano sul dispositivo; riprova la sincronizzazione.');
    throw error;
  } finally {
    clearTimeout(timer);
    options.signal?.removeEventListener('abort', cancel);
  }
}
