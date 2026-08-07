#!/usr/bin/env python3
"""Minimal Home Assistant REST / Supervisor client (stdlib only).

Extracted from the original ``ha-dev/setup.py`` so both the container's
self-provisioning entrypoint and the ``deploy/`` HAOS toolkit share one HTTP
implementation. PyYAML/urllib ship with HA core, so there are no third-party
deps — this runs unchanged inside the image and on an operator's machine.
"""
import json
import urllib.error
import urllib.parse
import urllib.request


def request(base_url, method, path, data=None, token=None, form=False):
    """Issue an HTTP request against a Home Assistant instance.

    Returns the decoded JSON body (or ``{}`` for an empty response). Raises
    ``urllib.error.HTTPError`` / ``URLError`` on failure so callers can branch
    on status codes (e.g. onboarding's 404-means-done).
    """
    headers = {}
    body = None
    if data is not None:
        if form:
            body = urllib.parse.urlencode(data).encode()
            headers["Content-Type"] = "application/x-www-form-urlencoded"
        else:
            body = json.dumps(data).encode()
            headers["Content-Type"] = "application/json"
    if token:
        headers["Authorization"] = "Bearer " + token
    req = urllib.request.Request(
        base_url.rstrip("/") + path, data=body, headers=headers, method=method
    )
    with urllib.request.urlopen(req) as r:
        raw = r.read().decode()
        return json.loads(raw) if raw else {}


def bind(base_url):
    """Return a ``_req(method, path, ...)`` bound to ``base_url`` — lets callers
    keep the terse call sites the original setup.py used."""

    def _req(method, path, data=None, token=None, form=False):
        return request(base_url, method, path, data=data, token=token, form=form)

    return _req
