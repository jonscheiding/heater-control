import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { afterEach, describe, expect, it, vi } from "vitest";

import { toClaims } from "../src/claims.js";
import { ScheduleMasterFlowError } from "../src/login.js";
import { getUserInfo } from "../src/user-info.js";

const fixture = await readFile(
  fileURLToPath(new URL("./fixtures/user-info.html", import.meta.url)),
  "utf8",
);

function mockFetch(response: Response) {
  const fn = vi.fn<typeof fetch>();
  fn.mockResolvedValue(response);
  vi.stubGlobal("fetch", fn);
  return fn;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const session = { userid: "12345", session: "deadbeef" };

describe("getUserInfo", () => {
  it("parses name and email from the UserInfo form", async () => {
    mockFetch(new Response(fixture, { status: 200 }));

    const user = await getUserInfo(session);

    expect(user).toEqual({
      userid: "12345",
      firstName: "Jonathan",
      lastName: "Scheiding",
      middleInitial: "Q",
      email: "jon@example.com",
    });
  });

  it("sends the session and GETUSER params, forwarding cookies", async () => {
    const fetchFn = mockFetch(new Response(fixture, { status: 200 }));

    await getUserInfo(session, "ASP.NET_SessionId=xyz");

    const url = new URL(fetchFn.mock.calls[0]![0] as URL);
    expect(url.pathname).toBe("/UserInfo.aspx");
    expect(url.searchParams.get("userid")).toBe("12345");
    expect(url.searchParams.get("session")).toBe("deadbeef");
    expect(url.searchParams.get("GETUSER")).toBe("M");

    const init = fetchFn.mock.calls[0]![1]!;
    expect((init.headers as Record<string, string>).cookie).toBe(
      "ASP.NET_SessionId=xyz",
    );
  });

  it("throws a flow error when the profile fields are missing", async () => {
    mockFetch(
      new Response("<html><body>Login required</body></html>", { status: 200 }),
    );

    await expect(getUserInfo(session)).rejects.toBeInstanceOf(
      ScheduleMasterFlowError,
    );
  });

  it("maps a parsed user onto OIDC claims", () => {
    const claims = toClaims(
      {
        userid: "12345",
        firstName: "Amelia",
        lastName: "Earhart",
        middleInitial: "M",
        email: "amelia@example.com",
      },
      "amelia",
    );

    expect(claims).toEqual({
      sub: "12345",
      name: "Amelia Earhart",
      given_name: "Amelia",
      family_name: "Earhart",
      email: "amelia@example.com",
      preferred_username: "amelia",
    });
  });
});
