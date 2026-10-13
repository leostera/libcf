// Minimal JS comparator for the C++ arithmetic endpoint (not full SDK parity).
export default {
  fetch(request, env) {
    const url = new URL(request.url);
    const a = Number(url.searchParams.get('a') ?? 1);
    const b = Number(url.searchParams.get('b') ?? 2);
    return new Response(`${env.GREETING}: ${a + b}`);
  },
};
