// Colocated tests for the shared rival-ownership guard — including the
// subdomain-hosted-rival case caught on a real audited run:
// firebase.google.com must be owned by "Firebase Authentication" even though
// its registrable domain (google.com) carries no rival token.
import { describe, expect, it } from "vitest";
import { competitorTokens, makeRivalOwner } from "./rival-owner";

describe("makeRivalOwner", () => {
  it("owns a rival's own registrable domain", () => {
    const owner = makeRivalOwner(["Auth0", "Firebase Authentication"], []);
    expect(owner("auth0.com")).toBe("Auth0");
  });

  it("owns a rival hosted on a SUBDOMAIN of another company (the firebase.google.com case)", () => {
    const owner = makeRivalOwner(["Auth0", "Firebase Authentication", "AWS Cognito"], []);
    expect(owner("firebase.google.com")).toBe("Firebase Authentication");
  });

  it("does not claim unrelated hosts (conservative >=4-char tokens)", () => {
    const owner = makeRivalOwner(["Jira", "Box"], []);
    expect(owner("cpoclub.com")).toBeNull();
    // "box" is only 3 chars — never a token, so dropbox.com stays unowned
    expect(owner("dropbox.com")).toBeNull();
  });

  it("owns a host a rival domain redirects into (corpus evidence)", () => {
    const owner = makeRivalOwner(
      ["SendGrid"],
      [{ url: "https://sendgrid.com/pricing", final_url: "https://www.twilio.com/sendgrid/pricing" }],
    );
    expect(owner("twilio.com")).toBe("SendGrid");
  });
});

describe("competitorTokens", () => {
  it("emits >=4-char tokens per rival name", () => {
    const toks = competitorTokens(["Firebase Authentication"]);
    expect(toks.some((t) => t.token === "firebase")).toBe(true);
    expect(toks.every((t) => t.token.length >= 4)).toBe(true);
  });
});
