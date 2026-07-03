import { afterEach, describe, expect, it, vi } from "vitest";

import { login, ScheduleMasterFlowError } from "../src/login.js";

function mockFetch(response: Response) {
  const fn = vi.fn<typeof fetch>();
  fn.mockResolvedValue(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

function redirect(location: string, headers: Record<string, string> = {}) {
  return new Response(null, {
    status: 302,
    headers: { location, ...headers },
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("login", () => {
  it("returns a session from the redirect query on success", async () => {
    const fetchFn = mockFetch(
      redirect("/Home.aspx?USERID=12345&SESSION=deadbeef"),
    );

    const result = await login("amelia", "correct-horse");

    expect(result).toEqual({
      ok: true,
      session: { userid: "12345", session: "deadbeef" },
      cookies: null,
    });

    // Sends the classic ASP.NET login form fields, without following redirects.
    const init = fetchFn.mock.calls[0]![1]!;
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("manual");
    expect((init.body as URLSearchParams).get("USERID")).toBe("amelia");
    expect((init.body as URLSearchParams).get("DATA")).toBe("correct-horse");
    expect((init.body as URLSearchParams).get("CMD")).toBe("LOGIN");
  });

  it("forwards Set-Cookie values as a Cookie header string", async () => {
    mockFetch(
      redirect("/Home.aspx?USERID=1&SESSION=s", {
        "set-cookie": "ASP.NET_SessionId=xyz; path=/; HttpOnly",
      }),
    );

    const result = await login("amelia", "pw");

    expect(result.ok && result.cookies).toBe("ASP.NET_SessionId=xyz");
  });

  it("reports invalid credentials on rd=loginerror", async () => {
    mockFetch(redirect("/login.asp?rd=loginerror"));

    await expect(login("amelia", "wrong")).resolves.toEqual({
      ok: false,
      reason: "invalid_credentials",
    });
  });

  it("reports a suspended account", async () => {
    mockFetch(redirect("/suspended.asp"));

    await expect(login("amelia", "pw")).resolves.toEqual({
      ok: false,
      reason: "suspended",
    });
  });

  it("throws a flow error when there is no redirect", async () => {
    mockFetch(new Response("<html>unexpected</html>", { status: 200 }));

    await expect(login("amelia", "pw")).rejects.toBeInstanceOf(
      ScheduleMasterFlowError,
    );
  });

  it("throws a flow error when the redirect lacks session params", async () => {
    mockFetch(redirect("/Home.aspx"));

    await expect(login("amelia", "pw")).rejects.toBeInstanceOf(
      ScheduleMasterFlowError,
    );
  });
});
