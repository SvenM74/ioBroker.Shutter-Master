# ioBroker.shutter-master

**Shutter Master** is a manufacturer-independent logic layer for scenario-based control of shutters, blinds, and awnings in ioBroker.

It connects existing actuator and sensor datapoints from adapters such as Shelly, Sonoff, KNX, and Homematic. It does not require specific hardware.

## Device configuration and manual controls

Configure each shading device in the adapter instance's graphical settings. Each row has a stable internal ID, a display name, and a device type. Add the full ioBroker IDs for open, close, position, and optional closed/tilted contact datapoints.

Each configured device creates these adapter datapoints:

- `devices.<id>.commands.open` and `devices.<id>.commands.close`: write `true` to send the configured JSON value to the mapped actuator datapoint.
- `devices.<id>.commands.position`: write a percentage from 0 (closed) to 100 (open). The adapter maps this to the configured closed and open endpoint values.
- `devices.<id>.status.closed` and `devices.<id>.status.tilted`: read-only boolean mirrors of the configured contacts. Each contact can be inverted for sensors with opposite polarity.

Open/close values accept JSON literals such as `true`, `false`, `1`, `0`, or quoted strings such as `"OPEN"`. The defaults are `true`. Configure these values to match the target adapter's datapoints.

## Planned capabilities

- Time and calendar schedules, including weekdays, weekends, and holidays
- Sunrise and sunset schedules with configurable offsets
- Dynamic shading based on sun azimuth and elevation
- Safety logic for open or tilted terrace and window contacts
- User-defined scenarios such as “Holiday”, “Present”, and “Heat Protection”

## Current status

The adapter now provides device configuration, normalized manual commands, and contact state mirroring. Automatic schedules, sun calculations, safety behavior, and the scenario engine are not implemented yet. Contact values are displayed, but they do not currently block commands or move devices automatically.

## Development

The adapter is a Node.js package named `iobroker.shutter-master`. Its admin interface uses ioBroker's JSON configuration format.

```sh
npm install
npm start
```

Contributions and feedback are welcome.