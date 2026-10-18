# ioBroker.shutter-master

**Shutter Master** is a manufacturer-independent logic layer for scenario-based control of shutters, blinds, and awnings in ioBroker.

It connects existing actuator and sensor datapoints from adapters such as Shelly, Sonoff, KNX, and Homematic. It does not require specific hardware.

## Project goal

Configure each shading device centrally in the adapter instance's graphical configuration. A device can represent a shutter, blind, or awning and can reference these existing ioBroker datapoints:

| Setting | Purpose |
| --- | --- |
| Name | Human-readable name for the configured device |
| Type | Shutter, blind, or awning |
| Open command | Datapoint used to open the device |
| Close command | Datapoint used to close the device |
| Position command | Optional datapoint for setting a target position |
| Closed contact | Optional datapoint reporting whether a window or door is closed |
| Tilted contact | Optional datapoint reporting whether a window or door is tilted |

Datapoint IDs are entered as full ioBroker object IDs. Actuator and contact datapoints are optional so devices with different capabilities can be configured.

## Planned capabilities

- Time and calendar schedules, including weekdays, weekends, and holidays
- Sunrise and sunset schedules with configurable offsets
- Dynamic shading based on sun azimuth and elevation
- Safety logic for open or tilted terrace and window contacts
- User-defined scenarios such as “Holiday”, “Present”, and “Heat Protection”

## Current status

This repository contains the initial adapter structure and graphical device configuration. The automatic control, schedules, sun calculations, safety behavior, and scenario engine are not implemented yet. Configuring devices does not move them.

## Development

The adapter is a Node.js package named `iobroker.shutter-master`. The admin interface uses ioBroker's JSON configuration format.

```sh
npm install
npm start
```

Contributions and feedback are welcome.