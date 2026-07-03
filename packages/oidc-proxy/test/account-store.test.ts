import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AccountStore } from "../src/account-store.js";

const claims = {
  sub: "12345",
  name: "Amelia Earhart",
  given_name: "Amelia",
  family_name: "Earhart",
  email: "amelia@example.com",
  preferred_username: "amelia",
};

describe("AccountStore", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns stored claims by sub", () => {
    const store = new AccountStore(600);
    store.set(claims);
    expect(store.get("12345")).toEqual(claims);
  });

  it("returns undefined for an unknown sub", () => {
    const store = new AccountStore(600);
    expect(store.get("nope")).toBeUndefined();
  });

  it("expires entries after the TTL", () => {
    const store = new AccountStore(600);
    store.set(claims);
    vi.advanceTimersByTime(600_000 + 1);
    expect(store.get("12345")).toBeUndefined();
  });
});
