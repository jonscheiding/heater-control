# HA integration patches

Local overrides for HACS-installed integrations. Each file here replaces its upstream counterpart inside HA's `custom_components/` directory after HACS has installed the integration.

## Contents

- `auth_oidc/endpoints/finish.py` — auto-continues past the "Continue on this device / Use a code from another device" screen so OIDC login is one-step for browser users. Trade-off: the device-code cross-device flow is broken (irrelevant here; pilots log in in their own browsers).

## Applying (manual, POC)

After HACS installs the integration, overlay the patched file(s) into the container:

```bash
docker cp homeassistant/patches/auth_oidc/endpoints/finish.py \
  <ha-container>:/config/custom_components/auth_oidc/endpoints/finish.py
docker restart <ha-container>
```

## Reapplying after integration updates

HACS updates overwrite the integration directory. After any `auth_oidc` update in HACS, redeploy the patched file(s). If the upstream file has diverged from what the patch was derived from, re-derive the patch by diffing against the fresh upstream copy before overlaying.

## When to delete

If upstream adds a config option to bypass the finish screen (or exposes an equivalent), remove the patch and use the config option instead. Track:

- https://github.com/christiaangoossens/hass-oidc-auth/issues
