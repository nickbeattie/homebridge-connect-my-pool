# Homebridge ConnectMyPool

A Homebridge 2 dynamic platform plugin for AstralPool ConnectMyPool systems.
It discovers the equipment configured for each pool and presents compatible
HomeKit accessories for pool temperature, heaters, solar heating, channels,
valves, lighting zones, favourites, and pool/spa selection.

## Requirements

- Homebridge 2.0 or later
- Node.js 22.10 or later in the Node 22 release line, or Node.js 24
- A supported ConnectMyPool installation with approved Home Automation access

ConnectMyPool requires an Astral Internet Gateway, Astral Touch Screen, and an
Astral Connect 10 or Connect Lite. The pool must be registered and communicating
with ConnectMyPool.

## Get a Pool API Code

The plugin authenticates with a pool-specific API code, not your ConnectMyPool
email address and password.

1. Sign in to [ConnectMyPool](https://www.connectmypool.com.au/) in a desktop
   browser.
2. Open **Settings**, then **Home Automation**.
3. If access is not already approved, enter a reason and select
   **Request Home Automation Access**.
4. After approval, return to **Home Automation** and copy the Pool API Code.

Treat the code as a password. The plugin puts it only in API request bodies and
does not include it in log or error messages.

## Install

First create a Homebridge backup. If you already use another ConnectMyPool
plugin, disable or remove it before continuing to avoid duplicate accessories.

In the Homebridge UI:

1. Open **Plugins**.
2. Search for `@nickbeattie/homebridge-connect-my-pool`.
3. Select **Install**.
4. Open the plugin settings, add your pool, and restart Homebridge.

On an official Homebridge Raspberry Pi or Debian/Ubuntu installation, you can
instead install it over SSH:

```sh
sudo hb-service add @nickbeattie/homebridge-connect-my-pool
sudo hb-service restart
```

Watch the Homebridge logs during the first start:

```sh
sudo hb-service logs
```

You should see the plugin load, register the `ConnectMyPool` platform, discover
your configured equipment, and report that each pool is ready. Pool API Codes
must never appear in the logs.

To remove the plugin:

```sh
sudo npm --prefix /var/lib/homebridge uninstall \
  @nickbeattie/homebridge-connect-my-pool

sudo hb-service restart
```

## Configure

Use the Homebridge UI settings form, or add a platform entry to the Homebridge
configuration:

```json
{
  "platform": "ConnectMyPool",
  "name": "ConnectMyPool",
  "pollIntervalSeconds": 60,
  "pools": [
    {
      "id": "backyard",
      "name": "Backyard Pool",
      "poolApiCode": "YOUR_POOL_API_CODE",
      "expose": {
        "heaters": true,
        "solar": true,
        "channels": true,
        "valves": true,
        "lighting": true,
        "favourites": true
      }
    }
  ]
}
```

Each pool needs:

- `id`: a permanent, unique identifier of 1–32 lowercase letters, digits, or
  hyphens. Do not change it after pairing; it anchors HomeKit accessory
  identities.
- `name`: the display-name prefix for that pool.
- `poolApiCode`: the secret API code from ConnectMyPool.
- `expose`: optional switches for hiding classes of accessories. Every class is
  enabled by default.

`pollIntervalSeconds` defaults to 60 and accepts 60–3600. Do not configure a
shorter interval: the vendor permits pool configuration and pool status calls
no more than once every 60 seconds.

Multiple pool objects can be added to `pools`. Each must have its own stable
`id` and API code.

## HomeKit mapping

| ConnectMyPool feature | HomeKit presentation | Behavior |
| --- | --- | --- |
| Pool system | Temperature Sensor | Reports the current water temperature in Celsius. |
| Pool/spa selection | Switch on the pool system | On selects Spa; off selects Pool. Shown only when supported. |
| Heater | Heater/Cooler | On/off, heat/cool selection where supported, and target temperature. |
| Solar system | Heater/Cooler | Active off/auto plus target auto/on and target temperature. |
| Channel | Switch | A momentary control that advances to the channel's next supported mode. |
| Valve | Valve | On selects On; off selects Off. The current Auto state is reported as active. |
| Lighting zone | Lightbulb | On selects On; off selects Off. The current Auto state is reported as on. |
| Favourite | Switch | Turning one on activates it. Turning it off does nothing because the API has no “deactivate favourite” action. |

The plugin discovers equipment from the API and retains stable accessory UUIDs
across restarts. Removing a device in ConnectMyPool or disabling its exposure
removes the corresponding accessory after the next configuration refresh.
Configuration is refreshed periodically; status is refreshed at the configured
poll interval and immediately after a successful action.

## Current limitations

- Channel modes can only be cycled, not selected directly, because that is the
  only channel action exposed by the API.
- Valve and lighting Auto mode can be observed but cannot be selected through
  the binary HomeKit controls.
- Lighting colors, lighting synchronization, and colour effects are not exposed
  in this release.
- The API is cloud-mediated, so physical equipment changes and actions can take
  time to propagate.
- Automatic migration from other ConnectMyPool plugins is not supported.

If replacing `homebridge-connect-my-pool-home-automation`, disable or remove the
old plugin before enabling this one to avoid duplicate HomeKit accessories.

## Development

```sh
npm ci
npm run lint
npm run typecheck
npm test
npm run build
npm run test:coverage
npm run package:check
```

Unit tests never contact ConnectMyPool. A gated live integration test is
available only when explicitly supplied an API code:

```sh
CONNECT_MY_POOL_API_CODE='your-code' npm test -- live-api.test.ts
```

The live test reads configuration and status, then submits a real action that
reapplies the first lighting zone's current mode. Use it only against a system
where that action is acceptable. The code is read from the environment and is
not printed by the test.

The normalized vendor API reference is in
[`docs/api/connectmypool-home-automation-api.md`](docs/api/connectmypool-home-automation-api.md).

## License

MIT License. See [LICENSE](LICENSE).
