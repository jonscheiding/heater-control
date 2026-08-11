# Self-provisioning Home Assistant image for the heater-control dev + demo stack.
#
# Build from the REPO ROOT so it can COPY both the reference config
# (homeassistant/) and this dir's tooling (ha-dev/):
#   docker build -f ha-dev/Dockerfile -t heater-control-ha:dev .
#
# The same image serves local dev (docker compose, bind-mounted packages) and
# the Fly demo (volume-less, HC_STAGE_CONFIG=1). Everything env-specific is
# rendered at start by docker-entrypoint.sh. A bind-mounted or volume /config
# hides anything baked at /config, so config is staged under /opt/provision and
# copied into /config at container start.

FROM ghcr.io/home-assistant/home-assistant:stable

# auth_oidc (hass-oidc-auth) is fetched from a tagged RELEASE at build time.
# The release asset (what HACS installs) contains the compiled static/style.css;
# the raw branch source only ships the Tailwind input.css, so the login page
# would 404 on its stylesheet. Pinned to keep the patch below in sync.
ARG AUTH_OIDC_VERSION="v1.1.1"

# Fetch auth_oidc and apply our local patch at build time — no HACS, no runtime
# download/overlay. The release zip has the component files at its root, so it
# extracts straight into the custom_component dir. Downloads use Python stdlib.
COPY homeassistant/patches/auth_oidc /opt/provision/patch/auth_oidc
RUN set -eux; \
    mkdir -p /opt/provision/custom_components/auth_oidc /tmp/dl; \
    get() { python -c "import sys,urllib.request as u; req=u.Request(sys.argv[1],headers={'User-Agent':'heater-control-build'}); open(sys.argv[2],'wb').write(u.urlopen(req).read())" "$1" "$2"; }; \
    get "https://github.com/christiaangoossens/hass-oidc-auth/releases/download/${AUTH_OIDC_VERSION}/hass-oidc-auth.zip" /tmp/dl/auth_oidc.zip; \
    python -m zipfile -e /tmp/dl/auth_oidc.zip /opt/provision/custom_components/auth_oidc; \
    cp -r /opt/provision/patch/auth_oidc/. /opt/provision/custom_components/auth_oidc/; \
    rm -rf /tmp/dl

# Reference config (baked; staged into /config at start).
COPY homeassistant/configuration.yaml /opt/provision/configuration.yaml
COPY homeassistant/packages /opt/provision/packages
COPY homeassistant/blueprints /opt/provision/blueprints
# Repo-tracked custom components (schedulemaster, ...) merge alongside the
# auth_oidc dir materialized above; the entrypoint stages them into /config.
COPY homeassistant/custom_components /opt/provision/custom_components
# Heater roster + generator (entrypoint renders packages from the demo roster).
COPY homeassistant/heaters.demo.json /opt/provision/heaters.demo.json
COPY homeassistant/gen_packages.py /opt/provision/gen_packages.py

# Tooling.
COPY ha-dev/render_config.py /opt/provision/render_config.py
COPY ha-dev/setup.py /opt/provision/setup.py
COPY ha-dev/docker-entrypoint.sh /opt/provision/docker-entrypoint.sh
RUN chmod +x /opt/provision/docker-entrypoint.sh

ENTRYPOINT ["/opt/provision/docker-entrypoint.sh"]
