module.exports = async function afterPack(context) {
  // electron-builder embeds the ICO and product metadata itself.  Avoid a
  // second post-pack PE rewrite here: it can invalidate a portable/unpacked
  // Electron executable on machines with stricter SmartScreen policies.
  void context;
};
