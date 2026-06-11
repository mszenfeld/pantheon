function makeSerenaDegradedNotifier(client, message) {
  let serenaMissing = false;
  let toastShown = false;
  return {
    markSerenaMissing(missing) {
      serenaMissing = missing;
    },
    async onEvent({ event }) {
      if (event.type !== "session.created") return;
      if (toastShown || !serenaMissing) return;
      try {
        console.error(`Pantheon: ${message}`);
        await client.tui.showToast({
          body: { variant: "warning", title: "Pantheon", message }
        });
      } catch {
      }
      toastShown = true;
    }
  };
}
export {
  makeSerenaDegradedNotifier
};
