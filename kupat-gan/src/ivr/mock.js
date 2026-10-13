// No real phone calls: "dialing" only logs the call. Use the simulator page
// in the admin UI to play the parent's side of the conversation.

export function createMockPhone() {
  return {
    name: 'mock',
    async dial(phones) {
      return { ok: true, simulated: phones.length };
    },
  };
}
