// Consent-card checks for a site that calls a partner, from the agentify-website skill's
// template tests (testConsentFocusesTheCardThenTheChat, testConsentLeavesFocusInThePage).
// The same file is used by every site in this repo; it only needs ../site.js and
// ../index.html. Run: node --test "sites/<site>/tests/*.test.mjs"
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { StubDocument } from "./stub_document.mjs";
import { StubElement } from "./stub_element.mjs";
import { StubOption } from "./stub_option.mjs";

const BASE = "http://localhost:8080";
globalThis.document = StubDocument.fromHtml(await readFile(new URL("../index.html", import.meta.url), "utf8"), `${BASE}/`);
globalThis.Option = StubOption;
const { AssistantMount } = await import("../site.js");

let shownCards = [];
let answerCard = null;

/** Stand in for the runtime's card: show shownCards when asked, wait for answerCard. */
function pendingCard() {
  document.provide("#ns-msgs .ns-consent", shownCards);
  return new Promise((resolve) => { answerCard = resolve; });
}

/** A stand-in consent card with a title. */
function consentCard(text) {
  const card = new StubElement("div");
  const title = new StubElement("div");
  title.textContent = text;
  card.provide(".ns-consent-title", [title]);
  return { card, title };
}

const INFO = { kind: "network", peerLabel: "Partner Site", peerOrigin: "partner.example", requestText: "What do you offer?" };

test("the consent card gets focus, and focus then returns to the chat", async () => {
  const older = consentCard("Contact Older Partner on your behalf?");
  const newest = consentCard("Contact Partner Site on your behalf?");
  document.provide("#ns-msgs .ns-consent", [older.card]);
  shownCards = [older.card, newest.card];
  const chatInput = new StubElement("textarea");
  document.provide("#ns-input", [chatInput]);
  AssistantMount.defaultConsent = pendingCard;
  const answer = AssistantMount.consent(INFO);
  assert.equal(newest.card.getAttribute("role"), "group");
  assert.equal(newest.card.getAttribute("aria-label"), newest.title.textContent);
  assert.equal(newest.title.tabIndex, -1);
  assert.equal(newest.title.focused, true, "the waiting card's title has focus");
  assert.notEqual(older.title.focused, true, "not an older card");
  assert.notEqual(chatInput.focused, true, "not the chat input while the card waits");
  answerCard("decline");
  assert.equal(await answer, "decline");
  assert.equal(chatInput.focused, true, "focus returns to the chat input");
});

test("a visitor typing in the page's own form keeps focus when a consent card appears", async () => {
  const newest = consentCard("Contact Partner Site on your behalf?");
  document.provide("#ns-msgs .ns-consent", []);
  shownCards = [newest.card];
  const chatInput = new StubElement("textarea");
  document.provide("#ns-input", [chatInput]);
  const field = new StubElement("input");
  field.closest = () => null; // outside the chat
  document.activeElement = field;
  try {
    AssistantMount.defaultConsent = pendingCard;
    const answer = AssistantMount.consent(INFO);
    assert.equal(newest.card.getAttribute("role"), "group");
    assert.notEqual(newest.title.focused, true, "the page's own form keeps focus");
    answerCard("decline");
    assert.equal(await answer, "decline");
    assert.notEqual(chatInput.focused, true);
  } finally {
    document.activeElement = null;
  }
});
