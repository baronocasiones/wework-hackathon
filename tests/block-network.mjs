globalThis.fetch = async () => {
  throw new Error("Unexpected network request during simulated Meta publishing");
};
