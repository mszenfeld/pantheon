async function probeSessionActive(probe) {
  if (probe === void 0) {
    return false;
  }
  try {
    return await probe();
  } catch {
    return false;
  }
}
export {
  probeSessionActive
};
