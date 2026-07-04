"""Finish route — patched to auto-continue on this device.

Skips the "Continue on this device / Use a code from another device"
choice screen. GET requests behave as if the user pressed "Continue on
this device", redirecting straight to the underlying redirect URI with
skip_oidc_redirect appended to prevent an OIDC loop.

Trade-off: the device-code cross-device flow is no longer accessible
via the browser (the choice screen is what surfaces it). Not a concern
for this project — all pilots authenticate directly in their own
browser session.

Derived from auth_oidc endpoints/finish.py. Reapply after any auth_oidc
update in HACS. See ../../README.md for the deploy step.
"""

from homeassistant.components.http import HomeAssistantView
from aiohttp import web
from ..provider import OpenIDAuthProvider
from ..tools.helpers import (
    error_response,
    get_valid_state_id,
    template_response,
    concat_url_query,
)

PATH = "/auth/oidc/finish"


class OIDCFinishView(HomeAssistantView):
    """OIDC Plugin Finish View (patched: auto-continue)."""

    requires_auth = False
    url = PATH
    name = "auth:oidc:finish"

    def __init__(
        self,
        oidc_provider: OpenIDAuthProvider,
    ) -> None:
        self.oidc_provider = oidc_provider

    async def get(self, request: web.Request) -> web.Response:
        """Auto-continue: behave as if the user pressed Continue on this device."""
        state_id = await get_valid_state_id(request, self.oidc_provider)
        if not state_id:
            return await error_response("Missing state cookie, please restart login.")

        redirect_uri = await self.oidc_provider.async_get_redirect_uri_for_state(
            state_id
        )
        if not redirect_uri:
            return await error_response("Invalid state, please restart login.")

        raise web.HTTPFound(
            location=concat_url_query(redirect_uri, "skip_oidc_redirect=true")
        )

    async def post(self, request: web.Request) -> web.Response:
        """Receive response (unchanged from upstream)."""

        # Get cookie to get the state_id
        state_id = await get_valid_state_id(request, self.oidc_provider)
        if not state_id:
            return await error_response("Missing state cookie, please restart login.")

        # Get redirect_uri from the state
        redirect_uri = await self.oidc_provider.async_get_redirect_uri_for_state(
            state_id
        )

        if not redirect_uri:
            return await error_response("Invalid state, please restart login.")

        # Get the message body
        data = await request.post()
        device_code = data.get("device_code")

        # We are trying sign-in on this browser
        if not device_code:
            # Redirect to this new URL for login, make sure to skip OIDC to prevent loops
            redirect_uri = concat_url_query(redirect_uri, "skip_oidc_redirect=true")
            raise web.HTTPFound(location=redirect_uri)

        # Check if we can link this device
        linked = await self.oidc_provider.async_link_state_to_code(
            state_id, device_code
        )

        if not linked:
            return await error_response(
                "Failed to link state to device code, please restart login."
            )

        return await template_response("device_success", {})
