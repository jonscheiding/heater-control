function required(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`Missing env var: ${name}`);
  return value;
}

function requiredList(name: string): string[] {
  return required(name)
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

export const config = {
  smartthingsSecretArn: required("SMARTTHINGS_SECRET_ARN"),
  smartthingsLocationId: required("SMARTTHINGS_LOCATION_ID"),
  oidcIssuer: required("OIDC_ISSUER"),
  oidcAudience: required("OIDC_AUDIENCE"),
  allowedEmails: new Set(requiredList("ALLOWED_EMAILS")),
};
