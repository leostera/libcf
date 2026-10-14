// Private JS reference: raw service-forwarded TCP, never an HTTP echo endpoint.
export default {
  async connect(socket) {
    socket.closed.catch(() => {});
    const info = await socket.opened;
    try {
      if (info.localAddress === 'slow.invalid:1234')
        await new Promise(resolve => setTimeout(resolve, 200));
      await socket.readable.pipeTo(socket.writable);
    } catch {
      // The negative fixtures intentionally cancel the peer on overflow/timeout.
    }
  },
  fetch() { return new Response('not found', { status: 404 }); },
};
