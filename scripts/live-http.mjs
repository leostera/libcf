import assert from 'node:assert/strict';

export function liveHttp(host, family) {
  if (!['cache', 'd1'].includes(family) ||
      !new RegExp(`^libcf-${family}-[a-f0-9]{10}\\.libcf\\.leostera\\.dev$`).test(host ?? ''))
    throw new Error('Expected an isolated test hostname under libcf.leostera.dev');
  return (path, init = {}) => fetch(`https://${host}${path}`, {
    ...init, redirect: 'error', signal: AbortSignal.timeout(10000),
  });
}

export async function awaitCertificate(request) {
  // Newly issued custom-domain certificates took ~5 minutes in the first
  // successful run. Never disable TLS verification or use workers.dev instead.
  for (let attempt = 0; attempt < 90; attempt++) {
    try {
      const response = await request('/libcf-readiness-missing-route');
      assert.equal(response.status, 404);
      await response.arrayBuffer();
      return;
    } catch (error) {
      if (attempt === 89) throw error;
      await new Promise(resolve => setTimeout(resolve, 10000));
    }
  }
}
