# Release checklist

This checklist covers the first release candidate. It deliberately stops before
publishing to npm.

## Automated verification

- [ ] Run on a supported Node.js release (22.10+ or 24).
- [ ] `npm ci`
- [ ] `npm audit --audit-level=high`
- [ ] `npm run check`
- [ ] `npm run test:coverage`
- [ ] `npm run package:check`
- [ ] Inspect the real tarball produced by `npm pack`.
- [ ] Confirm CI passes on Node.js 22 and 24.

## Homebridge verification

- [ ] Install the tarball into a disposable Homebridge 2 instance.
- [ ] Confirm `config.schema.json` renders and saves in Homebridge UI.
- [ ] Start with an invalid API code and confirm the secret is absent from logs.
- [ ] Start with a valid API code and confirm only configured devices appear.
- [ ] Restart Homebridge and confirm accessory UUIDs and room assignments remain.
- [ ] Disable one exposure class and confirm only those accessories are removed.
- [ ] Remove a pool and confirm its cached accessories are unregistered.
- [ ] Confirm shutdown leaves no polling or action requests running.

## Device verification

- [ ] Compare temperature and every reported mode with ConnectMyPool.
- [ ] Verify pool/spa selection in both directions when supported.
- [ ] Verify heater on/off, heating/cooling selection, and pool/spa set points.
- [ ] Verify solar off, auto, on, and target temperature.
- [ ] Verify each channel control advances exactly one mode and resets to off.
- [ ] Verify each valve's off/on action and Auto readback.
- [ ] Verify each lighting zone's off/on action and Auto readback.
- [ ] Activate each favourite and confirm the active favourite readback.
- [ ] Simulate a network failure and confirm last-known values are preserved.
- [ ] Confirm actions are serialized and failures are surfaced to HomeKit.

## Release preparation

- [ ] Decide the final npm scope/package name and add repository metadata.
- [ ] Remove `"private": true` only when publication is intentionally approved.
- [ ] Confirm the package name is available on npm.
- [ ] Add a changelog entry and choose the semantic version.
- [ ] Review README limitations and migration guidance.
- [ ] Confirm there are no credentials, Pool API Codes, fixtures from the live
      account, or generated environment files in Git or the package tarball.
- [ ] Tag the verified commit only after the installed tarball passes smoke
      testing.
