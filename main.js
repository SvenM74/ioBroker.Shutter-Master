const utils = require("@iobroker/adapter-core");

class ShutterMaster extends utils.Adapter {
  constructor(options) {
    super({
      ...options,
      name: "shutter-master",
    });

    this.on("ready", () => void this.onReady());
  }

  async onReady() {
    try {
      const devices = Array.isArray(this.config.devices) ? this.config.devices : [];
      this.log.info(
        `Loaded configuration for ${devices.length} shading device(s). Automatic control is not implemented yet.`,
      );
    } catch (error) {
      this.log.error(`Startup failed: ${error instanceof Error ? error.message : error}`);
    }
  }
}

if (require.main !== module) {
  module.exports = options => new ShutterMaster(options);
} else {
  (() => new ShutterMaster())();
}