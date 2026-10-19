const utils = require("@iobroker/adapter-core");

class ShutterMaster extends utils.Adapter {
  constructor(options) {
    super({ ...options, name: "shutter-master" });
    this.commandMap = new Map();
    this.contactMap = new Map();
    this.subscribedForeignIds = new Set();
    this.addedShellyChannels = new Set();

    this.on("ready", () => void this.onReady());
    this.on("stateChange", (id, state) => void this.onStateChange(id, state));
    this.on("foreignStateChange", (id, state) => void this.onForeignStateChange(id, state));
    this.on("message", obj => void this.onMessage(obj));
  }

  async onMessage(obj) {
    if (!obj || !obj.callback) return;

    try {
      if (obj.command === "discoverShadingDevices" || obj.command === "discoverShellyShutters") {
        const options = await this.findShadingDevices();
        this.sendTo(obj.from, obj.command, options, obj.callback);
        return;
      }
      if (obj.command === "addShadingDevice" || obj.command === "addShellyShutter") {
        const result = await this.addShadingDevice(obj.message);
        this.sendTo(obj.from, obj.command, result, obj.callback);
        return;
      }
      this.sendTo(obj.from, obj.command, [], obj.callback);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.log.warn(`Shading device discovery failed: ${message}`);
      const response = String(obj.command || "").startsWith("discover") ? [] : { error: message };
      this.sendTo(obj.from, obj.command, response, obj.callback);
    }
  }

  

  async getShellyShutterCandidates() {
    const objects = await this.getForeignObjectsAsync("shelly.*", "state");
    const grouped = new Map();

    for (const [id, object] of Object.entries(objects || {})) {
      if (
        !/^shelly\.\d+\./.test(id) ||
        object?.type !== "state" ||
        object.common?.role !== "level.blind" ||
        object.common?.type !== "number" ||
        object.common?.write !== true
      ) {
        continue;
      }

      const lastDot = id.lastIndexOf(".");
      if (lastDot <= 0) continue;
      const channelId = id.slice(0, lastDot);
      const candidate = { id, object, channelId };
      const current = grouped.get(channelId);
      if (!current || this.getShellyPositionRank(candidate) > this.getShellyPositionRank(current)) {
        grouped.set(channelId, candidate);
      }
    }

    return Promise.all([...grouped.values()].map(async candidate => {
      const parentDot = candidate.channelId.lastIndexOf(".");
      const deviceId = parentDot > 0 ? candidate.channelId.slice(0, parentDot) : "";
      const [channel, device] = await Promise.all([
        this.getForeignObjectAsync(candidate.channelId).catch(() => null),
        deviceId ? this.getForeignObjectAsync(deviceId).catch(() => null) : null,
      ]);

      const deviceName = this.resolveObjectName(device?.common?.name);
      const channelName =
        this.resolveObjectName(channel?.common?.name) ||
        candidate.channelId.slice(candidate.channelId.lastIndexOf(".") + 1);
      if (!this.isShellyShutterChannel(candidate.channelId, channelName)) return null;

      const name = deviceName || channelName;
      const min = Number(candidate.object.common.min);
      const max = Number(candidate.object.common.max);

      return {
        channelId: candidate.channelId,
        positionId: candidate.id,
        name,
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 100,
      };
    })).then(candidates => candidates.filter(Boolean));
  }

  isShellyShutterChannel(channelId, channelName) {
    const idName = channelId.slice(channelId.lastIndexOf(".") + 1);
    const text = `${idName} ${channelName}`.toLowerCase();

    // Shelly can expose favorite positions with the same level.blind role.
    // Those are presets, not independent shutter channels.
    if (/favorites?/i.test(text)) return false;

    return /(shutter|roller|cover|rollladen|jalousie|blind)/.test(text);
  }

  getShellyPositionRank(candidate) {
    const idPart = candidate.id.slice(candidate.id.lastIndexOf(".") + 1).toLowerCase();
    const name = this.resolveObjectName(candidate.object.common?.name).toLowerCase();
    const text = `${idPart} ${name}`;
    let rank = 0;
    if (/position|level/.test(text)) rank += 1;
    if (/target|setpoint|command|control/.test(text)) rank += 2;
    if (/^position$/.test(idPart)) rank += 1;
    return rank;
  }

  async getDeviceAdapterShutterCandidates() {
    const objects = await this.getForeignObjectsAsync("alias.0.*", "state");
    const grouped = new Map();

    for (const [id, object] of Object.entries(objects || {})) {
      if (
        !id.startsWith("alias.0.") ||
        object?.type !== "state" ||
        object.common?.role !== "level.blind" ||
        object.common?.type !== "number" ||
        object.common?.write !== true
      ) {
        continue;
      }

      const lastDot = id.lastIndexOf(".");
      if (lastDot <= "alias.0".length) continue;
      const channelId = id.slice(0, lastDot);
      const candidate = { id, object, channelId };
      const current = grouped.get(channelId);
      if (!current || this.getShellyPositionRank(candidate) > this.getShellyPositionRank(current)) {
        grouped.set(channelId, candidate);
      }
    }

    return Promise.all([...grouped.values()].map(async candidate => {
      const parentDot = candidate.channelId.lastIndexOf(".");
      const deviceId = parentDot > "alias.0".length ? candidate.channelId.slice(0, parentDot) : candidate.channelId;
      const [channel, device] = await Promise.all([
        this.getForeignObjectAsync(candidate.channelId).catch(() => null),
        this.getForeignObjectAsync(deviceId).catch(() => null),
      ]);
      const name =
        this.resolveObjectName(device?.common?.name) ||
        this.resolveObjectName(channel?.common?.name) ||
        candidate.channelId.slice(candidate.channelId.lastIndexOf(".") + 1);
      const sourceIds = this.getAliasSourceIds(candidate.object);
      if (!sourceIds.length) return null;
      const dataSource = this.getAdapterDisplayName(sourceIds[0]);
      const min = Number(candidate.object.common.min);
      const max = Number(candidate.object.common.max);

      return {
        key: candidate.channelId,
        channelId: candidate.channelId,
        positionId: candidate.id,
        name,
        source: "Device Manager",
        dataSource,
        sourceIds,
        min: Number.isFinite(min) ? min : 0,
        max: Number.isFinite(max) ? max : 100,
      };
    })).then(candidates => candidates.filter(Boolean));
  }

  getAliasSourceIds(object) {
    const aliasId = object?.common?.alias?.id;
    if (typeof aliasId === "string") return [aliasId];
    if (aliasId && typeof aliasId === "object") {
      return [aliasId.write, aliasId.read].filter(value => typeof value === "string" && value.length > 0);
    }
    return [];
  }

  getAdapterDisplayName(id) {
    const adapter = String(id || "").split(".")[0].toLowerCase();
    const knownNames = {
      "shelly": "Shelly",
      "hm-rpc": "Homematic",
      "hmip": "Homematic IP",
      "knx": "KNX",
      "sonoff": "Sonoff",
      "zigbee": "Zigbee",
      "matter": "Matter",
      "modbus": "Modbus",
      "mqtt": "MQTT",
      "zwave": "Z-Wave",
    };
    return knownNames[adapter] || (adapter ? adapter[0].toUpperCase() + adapter.slice(1) : "Unbekannt");
  }

  async getShadingCandidates() {
    const [shelly, deviceAdapter] = await Promise.all([
      this.getShellyShutterCandidates(),
      this.getDeviceAdapterShutterCandidates(),
    ]);
    const usedShellyChannels = new Set();

    // A linked alias from the Device Manager is the preferred source when it
    // points to the same Shelly device. Keep the direct Shelly entry only when
    // no matching device-manager data link exists.
    const preferredDevices = deviceAdapter.map(candidate => {
      const normalizedName = this.normalizeDeviceId(candidate.name);
      for (const shellyCandidate of shelly) {
        const targetMatch = candidate.sourceIds.some(id =>
          id === shellyCandidate.positionId || id.startsWith(`${shellyCandidate.channelId}.`),
        );
        const nameMatch =
          normalizedName &&
          normalizedName === this.normalizeDeviceId(shellyCandidate.name) &&
          candidate.sourceIds.some(id => id.startsWith("shelly."));
        if (targetMatch || nameMatch) usedShellyChannels.add(shellyCandidate.channelId);
      }
      return candidate;
    });

    const directDevices = shelly
      .filter(candidate => !usedShellyChannels.has(candidate.channelId))
      .map(candidate => ({
        ...candidate,
        key: candidate.channelId,
        source: "Direkt",
        dataSource: "Shelly",
        sourceIds: [candidate.positionId],
      }));

    return [...preferredDevices, ...directDevices].sort((a, b) =>
      a.name.localeCompare(b.name, "de", { sensitivity: "base", numeric: true }),
    );
  }

  async findShadingDevices() {
    const candidates = await this.getShadingCandidates();
    return candidates.map(candidate => ({
      value: candidate.key,
      label: candidate.name,
    }));
  }

  

  async addShadingDevice(message) {
    const key =
      typeof message === "string"
        ? message.trim()
        : String(message?.key || message?.channelId || message?.shadingDevice || message?.shellyShutter || "").trim();
    if (!key) {
      return { error: "Bitte zuerst ein Beschattungsgerät auswählen." };
    }

    const candidate = (await this.getShadingCandidates()).find(item => item.key === key);
    if (!candidate) {
      return { error: "Das ausgewählte Beschattungsgerät wurde nicht gefunden. Bitte die Liste aktualisieren." };
    }

    const currentConfig = this.config && typeof this.config === "object" ? this.config : {};
    const devices = Array.isArray(currentConfig.devices) ? [...currentConfig.devices] : [];
    const deviceMappings = { ...(currentConfig.deviceMappings || {}) };
    if (
      this.addedShellyChannels.has(candidate.key) ||
      devices.some(device => {
        const mapping = deviceMappings[this.normalizeDeviceId(device.deviceId)] || device;
        return (
          String(mapping.positionId || "").trim() === candidate.positionId ||
          String(mapping.deviceSourceId || device.deviceSourceId || "").trim() === candidate.key
        );
      })
    ) {
      return { error: `„${candidate.name}“ ist bereits in der Geräteliste enthalten.` };
    }

    const baseId = this.normalizeDeviceId(candidate.name) || this.normalizeDeviceId(candidate.channelId.split(".").pop()) || "beschattungsgeraet";
    const usedIds = new Set(devices.map(device => this.normalizeDeviceId(device.deviceId)).filter(Boolean));
    let deviceId = baseId;
    let suffix = 2;
    while (usedIds.has(deviceId)) deviceId = `${baseId}-${suffix++}`;

    const device = {
      deviceId,
      name: candidate.name,
      source: candidate.source,
      dataSource: candidate.dataSource,
    };
    deviceMappings[deviceId] = {
      deviceSourceId: candidate.key,
      deviceType: "shutter",
      openId: candidate.positionId,
      openValue: String(candidate.max),
      closeId: candidate.positionId,
      closeValue: String(candidate.min),
      positionId: candidate.positionId,
      positionClosedValue: candidate.min,
      positionOpenValue: candidate.max,
      closedContactId: "",
      closedContactInvert: false,
      tiltedContactId: "",
      tiltedContactInvert: false,
    };

    this.addedShellyChannels.add(candidate.key);
    return {
      native: {
        ...currentConfig,
        devices: [...devices, device].sort((a, b) =>
          String(a.name || "").localeCompare(String(b.name || ""), "de", { sensitivity: "base", numeric: true }),
        ),
        deviceMappings,
      },
      saveConfig: true,
    };
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
      const deviceMappings = await this.getDeviceMappings(configuredDevices);
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
        await this.configureDevice(deviceId, { ...configured, ...(deviceMappings[deviceId] || {}) });
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

  async getDeviceMappings(devices) {
    const mappings = { ...(this.config.deviceMappings || {}) };
    let changed = false;

    for (const device of devices) {
      const deviceId = this.normalizeDeviceId(device.deviceId);
      if (!deviceId) continue;
      const existing = mappings[deviceId] || {};
      const legacy = {};
      for (const key of [
        "deviceType",
        "openId",
        "openValue",
        "closeId",
        "closeValue",
        "positionId",
        "positionClosedValue",
        "positionOpenValue",
        "closedContactId",
        "closedContactInvert",
        "tiltedContactId",
        "tiltedContactInvert",
      ]) {
        if (device[key] !== undefined) legacy[key] = device[key];
      }
      const mapping = { ...legacy, ...existing };
      if (Object.keys(mapping).length && !this.config.deviceMappings?.[deviceId]) {
        mappings[deviceId] = mapping;
        changed = true;
      }

      if (!device.source || !device.dataSource) {
        const positionId = mapping.positionId || device.positionId || "";
        const sourceObject = positionId ? await this.getForeignObjectAsync(positionId).catch(() => null) : null;
        const sourceIds = this.getAliasSourceIds(sourceObject);
        device.source ||= positionId.startsWith("alias.0.") ? "Device Manager" : "Direkt";
        device.dataSource ||= this.getAdapterDisplayName(sourceIds[0] || positionId);
        changed = true;
      }

      for (const key of [
        "deviceType",
        "openId",
        "openValue",
        "closeId",
        "closeValue",
        "positionId",
        "positionClosedValue",
        "positionOpenValue",
        "closedContactId",
        "closedContactInvert",
        "tiltedContactId",
        "tiltedContactInvert",
        "deviceSourceId",
      ]) {
        delete device[key];
      }
    }

    if (changed) {
      this.config.deviceMappings = mappings;
      try {
        await this.extendForeignObjectAsync(`system.adapter.${this.namespace}`, {
          native: { deviceMappings: mappings, devices },
        });
      } catch (error) {
        this.log.warn(`Could not migrate device mappings: ${error instanceof Error ? error.message : error}`);
      }
    }

    return mappings;
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