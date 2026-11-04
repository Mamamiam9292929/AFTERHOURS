// P12 · Anmeldung mit Google und Apple (src/lib/authproviders.ts, Typen entfernt Node selbst).
import assert from "node:assert/strict";
import { test } from "node:test";
import { enabledProviders, needsAgeConfirmation, oauthReturnFailed } from "../../src/lib/authproviders.ts";

test("Anbieter nur, wenn das Projekt sie einschaltet", () => {
  assert.deepEqual(enabledProviders({ external: { email: true, google: true, apple: true } }), ["google", "apple"]);
  assert.deepEqual(enabledProviders({ external: { apple: true, google: false } }), ["apple"]);
  assert.deepEqual(enabledProviders({ external: { email: true, github: true } }), []);
  // Unerwartete Antworten zählen als „aus“ – lieber kein Knopf als einer ins Leere.
  assert.deepEqual(enabledProviders({ external: { google: "true" } }), []);
  assert.deepEqual(enabledProviders({}), []);
  assert.deepEqual(enabledProviders(null), []);
  assert.deepEqual(enabledProviders("google"), []);
  assert.deepEqual(enabledProviders({ external: null }), []);
});

test("Altersbestätigung im Onboarding nur für Konten über Google oder Apple", () => {
  assert.equal(needsAgeConfirmation({ provider: "google", providers: ["google"] }), true);
  assert.equal(needsAgeConfirmation({ provider: "apple" }), true);
  assert.equal(needsAgeConfirmation({ provider: "email", providers: ["email", "google"] }), false);
  assert.equal(needsAgeConfirmation({}), false);
  assert.equal(needsAgeConfirmation(undefined), false);
  assert.equal(needsAgeConfirmation({ provider: ["google"] }), false);
});

test("Rückkehr vom Anbieter mit Fehler", () => {
  assert.equal(oauthReturnFailed("?via=oauth&error=access_denied&error_description=User+denied", ""), true);
  assert.equal(oauthReturnFailed("?via=oauth", "#error=server_error&error_code=bad_oauth_state"), true);
  assert.equal(oauthReturnFailed("?via=oauth", "#access_token=abc&refresh_token=def"), false);
  assert.equal(oauthReturnFailed("", ""), false);
  assert.equal(oauthReturnFailed("?terror=1", "#mirror=x"), false);
});
