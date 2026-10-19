const utils = require("@iobroker/adapter-core");

class ShutterMaster extends utils.Adapter {
  constructor(options) {
    super({ ...options, name: "shutter-master" });
    this.commandMap = new Map();
    this.contactMap = new Map();
    this.subscribedForeignIds = new Set();

    this.on("ready", () => void this.onReady());
    this.on("stateChange", (id, state) => void this.onStateChange(id, state));
    this.on("foreignStateChange", (id, state) => void this.onForeignStateChange(id, state));
    this.on("message", obj => void this.onMessage(obj));
  }

  async onMessage(obj) {
    if (!obj || !obj.callback) return;

    try {
      if (obj.command === "discoverShellyShutters") {
        const options = await this.findShellyShutters();
        this.sendTo(obj.from, obj.command, options, obj.callback);
        return;
      }
      this.sendTo(obj.from, obj.command, [], obj.callback);
    } catch (error) {
      this.log.warn(`Shelly shutter discovery failed: ${error instanceof Error ? error.message : error}`);
      this.sendTo(obj.from, obj.command, [], obj.callback);
    }
  }

  async findShellyShutters() {
    const objects = await this.getForeignObjectsAsync("shelly.*", "state");
    const entries = Object.entries(objects || {}).filter(([id, object]) =>
      /^shelly\\.\\d+\\./.test(id) &&
      object?.type === "state" &&
      object.common?.role === "level.blind" &&
      object.common?.type === "number" &&
      object.common?.write === true,
    );

    const options = await Promise.all(entries.map(async ([id, object]) => {
      const lastDot = id.lastIndexOf(".");
      const channelId = lastDot > 0 ? id.slice(0, lastDot) : "";
      const deviceId = channelId.includes(".") ? channelId.slice(0, channelId.lastIndexOf(".")) : "";
      const [channel, device] = await Promise.all([
        channelId ? this.getForeignObjectAsync(channelId).catch(() => null) : null,
        deviceId ? this.getForeignObjectAsync(deviceId).catch(() => null) : null,
      ]);
      const deviceName = this.resolveObjectName(device?.common?.name);
      const channelName = this.resolveObjectName(channel?.common?.name) || this.resolveObjectName(object.common.name);
      const labelParts = [deviceName, channelName].filter(Boolean);
      const label = labelParts.length ? `${labelParts.join(" / ")} — ${id}` : id;
      return { value: id, label };
    }));

    return options.sort((a, b) => a.label.localeCompare(b.label));
  }

  resolveObjectName(name) {
    if (typeof name === "string") return name.trim();
    if (name && typeof name === "object") {
      return String(name.de || name.en || Object.values(name)[0] || "").trim();
    }
    return "";
  }

  async onReady() {
    try {
      const configuredDevices = Array.isArray(this.config.devices) ? this.config.devices : [];
      const seenIds = new Set();

      for (const configured of configuredDevices) {
        const deviceId = this.normalizeDeviceId(configured.deviceId);
        if (!deviceId || !configured.name) {
          this.log.warn("Skipping a device without a valid internal ID and name.");
          continue;
        }
        if (seenIds.has(deviceId)) {
          this.log.warn(`Skipping duplicate device ID "${deviceId}".`);
          continue;
        }
        seenIds.add(deviceId);
        await this.configureDevice(deviceId, configured);
      }

      await this.subscribeStatesAsync("*");
      await this.loadContactValues();
      this.log.info(`Configured ${seenIds.size} shading device(s).`);
    } catch (error) {
      this.log.error(`Startup failed: ${error instanceof Error ? error.message : error}`);
    }
  }

  normalizeDeviceId(value) {
    return String(value || "")
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9_-]+/g, "-")
      .replace(/^-+|-+$/g, "");
  }

  async configureDevice(deviceId, configured) {
    const baseId = `devices.${deviceId}`;
    const displayName = String(configured.name).trim();
    const type = configured.deviceType || "shutter";

    await this.setObjectNotExistsAsync(baseId, {
      type: "device",
      common: { name: displayName },
      native: {},
    });
    await this.setObjectNotExistsAsync(`${baseId}.commands`, {
      type: "channel",
      common: { name: "Commands" },
      native: {},
    });
    await this.setObjectNotExistsAsync(`${baseId}.status`, {
      type: "channel",
      common: { name: "Contact status" },
      native: {},
    });

    const buttonStates = [
      { key: "open", label: "Open" },
      { key: "close", label: "Close" },
    ];
    for (const button of buttonStates) {
      const localId = `${baseId}.commands.${button.key}`;
      await this.setObjectNotExistsAsync(localId, {
        type: "state",
        common: {
          name: button.label,
          type: "boolean",
          role: "button",
          read: true,
          write: true,
          def: false,
        },
        native: {},
      });
      this.commandMap.set(`${this.namespace}.${localId}`, {
        localId,
        targetId: String(configured[`${button.key}Id`] || "").trim(),
        value: this.parseConfiguredValue(configured[`${button.key}Value`], true),
        kind: button.key,
        deviceName: displayName,
      });
    }

    const positionId = `${baseId}.commands.position`;
    await this.setObjectNotExistsAsync(positionId, {
      type: "state",
      common: {
        name: "Set position",
        type: "number",
        role: "level.blind",
        unit: "%",
        min: 0,
        max: 100,
        read: true,
        write: true,
      },
      native: {},
    });
    this.commandMap.set(`${this.namespace}.${positionId}`, {
      localId: positionId,
      targetId: String(configured.positionId || "").trim(),
      kind: "position",
      closedValue: this.parseNumber(configured.positionClosedValue, 0),
      openValue: this.parseNumber(configured.positionOpenValue, 100),
      deviceName: displayName,
    });

    const infoId = `${baseId}.status.deviceType`;
    await this.setObjectNotExistsAsync(infoId, {
      type: "state",
      common: {
        name: "Device type",
        type: "string",
        role: "text",
        read: true,
        write: false,
      },
      native: {},
    });
    await this.setStateAsync(infoId, { val: type, ack: true });

    await this.configureContact(baseId, "closed", "Window or door closed", configured.closedContactId, configured.closedContactInvert, displayName);
    await this.configureContact(baseId, "tilted", "Window tilted", configured.tiltedContactId, configured.tiltedContactInvert, displayName);
  }

  async configureContact(baseId, key, label, sourceValue, invertValue, deviceName) {
    const sourceId = String(sourceValue || "").trim();
    const localId = `${baseId}.status.${key}`;
    await this.setObjectNotExistsAsync(localId, {
      type: "state",
      common: {
        name: label,
        type: "boolean",
        role: "indicator",
        read: true,
        write: false,
      },
      native: { sourceId },
    });

    if (!sourceId) return;
    const targets = this.contactMap.get(sourceId) || [];
    targets.push({ localId, invert: invertValue === true, deviceName });
    this.contactMap.set(sourceId, targets);
    if (!this.subscribedForeignIds.has(sourceId)) {
      this.subscribedForeignIds.add(sourceId);
      try {
        await this.subscribeForeignStatesAsync(sourceId);
      } catch (error) {
        this.log.warn(`Could not subscribe to contact "${sourceId}": ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  async loadContactValues() {
    for (const sourceId of this.subscribedForeignIds) {
      try {
        const state = await this.getForeignStateAsync(sourceId);
        if (state) await this.updateContactValues(sourceId, state);
      } catch (error) {
        this.log.warn(`Could not read contact "${sourceId}": ${error instanceof Error ? error.message : error}`);
      }
    }
  }

  async onStateChange(id, state) {
    if (!state || state.ack) return;
    const command = this.commandMap.get(id);
    if (!command) return;

    try {
      if (!command.targetId) {
        throw new Error("No target datapoint is configured for this command.");
      }

      let value;
      if (command.kind === "position") {
        const requested = Number(state.val);
        if (!Number.isFinite(requested) || requested < 0 || requested > 100) {
          throw new Error("Position must be a number between 0 and 100.");
        }
        value = command.closedValue + (requested / 100) * (command.openValue - command.closedValue);
      } else {
        value = command.value;
      }

      await this.setForeignStateAsync(command.targetId, { val: value, ack: false });
      this.log.debug(`Sent ${command.kind} command to "${command.targetId}" for "${command.deviceName}".`);
      const stateValue = command.kind === "position" ? Number(state.val) : false;
      await this.setStateAsync(command.localId, { val: stateValue, ack: true });
    } catch (error) {
      this.log.warn(`Command for "${command.deviceName}" failed: ${error instanceof Error ? error.message : error}`);
      if (command.kind !== "position") {
        await this.setStateAsync(command.localId, { val: false, ack: true });
      } else if (typeof state.val === "number" && Number.isFinite(state.val)) {
        await this.setStateAsync(command.localId, { val: state.val, ack: true });
      }
    }
  }

  async onForeignStateChange(id, state) {
    if (!state) return;
    await this.updateContactValues(id, state);
  }

  async updateContactValues(sourceId, state) {
    const targets = this.contactMap.get(sourceId);
    if (!targets) return;
    const value = this.toBoolean(state.val);
    if (value === null) {
      this.log.warn(`Contact "${sourceId}" did not provide a boolean-compatible value.`);
      return;
    }
    for (const target of targets) {
      await this.setStateAsync(target.localId, { val: target.invert ? !value : value, ack: true });
    }
  }

  toBoolean(value) {
    if (value === true || value === 1 || value === "true" || value === "1") return true;
    if (value === false || value === 0 || value === "false" || value === "0") return false;
    return null;
  }

  parseConfiguredValue(value, fallback) {
    if (value === undefined || value === null || String(value).trim() === "") return fallback;
    const text = String(value).trim();
    try {
      return JSON.parse(text);
    } catch {
      return text;
    }
  }

  parseNumber(value, fallback) {
    const parsed = Number(value);
    return value === undefined || value === null || value === "" || !Number.isFinite(parsed) ? fallback : parsed;
  }
}

if (require.main !== module) {
  module.exports = options => new ShutterMaster(options);
} else {
  (() => new ShutterMaster())();
}