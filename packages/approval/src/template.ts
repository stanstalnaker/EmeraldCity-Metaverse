/**
 * The default approval.md for a HubID agent in Emerald City. Same format as Edge City's Agent
 * Village template, so the file works in both. The rows Agent Village uses (intent.publish.*,
 * opportunity.accept, message.send, network.call, read.web, the gate's own organs) keep the
 * same names and defaults; the Hub Culture rows cover land, VEN, stores and cities.
 *
 * Shape: agents talk, move, ask Zeke and negotiate on their own (recorded); anything that
 * spends VEN, changes who owns land, publishes for the owner or commits them waits for the
 * owner's tap; cities, credentials and the policy itself are human-only.
 */
export const DEFAULT_APPROVAL_MD = `# Approval policy (Emerald City agent, default)

Your agent acts for you inside Emerald City and partner cities. This file says what it may do on
its own and what waits for you. Change a row from your HubID agent settings; every change is
recorded.

\`\`\`yaml approval-policy
version: "0.1"

defaults:
  autonomy: manual
  channel: hub
  approval_ttl: 72h
  on_expiry: reject
  unmapped_tool: ask

approvers:
  owner:
    channels: [hub, telegram]
    senders: {}

channels:
  hub:
    prompt:
      say:
        parcel.claim:
          does: "claim land for you"
          quote: { city: "City", parcel_id: ~, area_ha: "Size (ha)", ven: "Cost (VEN)" }
        parcel.transfer.p2p:
          does: "transfer one of your parcels"
          quote: { parcel_id: ~, to: "To", price_ven: "Price (VEN)" }
        parcel.transfer.brokered:
          does: "sell or buy a parcel through a broker (1% fee)"
          quote: { parcel_id: ~, counterparty: "With", price_ven: "Price (VEN)", broker: "Broker" }
        ven.send:
          does: "send VEN from your account"
          quote: { to: "To", amount: "Amount (VEN)", memo: "Memo" }
        store.design.post:
          does: "post a design to your Hub store"
          quote: { title: "Design", price_ven: "Price (VEN)", hub: "Store" }
        council.placement.request:
          does: "ask the City Council to approve a placement"
          quote: { city: "City", parcel_id: ~, design: "Design" }
        land.link.rent:
          does: "set rent for links to your Gaia land"
          quote: { parcel_id: ~, rent_ven: "Rent (VEN)" }
        profile.update:
          does: "change your HubID profile"
          quote: { field: "Field", value: "New value" }
        intent.publish.inferred.index:
          does: "post this on Index as something it thinks you want"
          quote: { text: "" }
          note: none
        meeting.book:
          does: "book a meeting for you"
          quote: { with: "With", when: "When", where: "Where" }

classes:
  # Land and money: wait for the owner.
  parcel.claim:                 { autonomy: manual, agent_may_request: true }
  parcel.transfer.p2p:          { autonomy: manual, agent_may_request: true }
  parcel.transfer.brokered:     { autonomy: manual, agent_may_request: true }
  ven.send:                     { autonomy: manual, agent_may_request: true }
  land.link.rent:               { autonomy: manual, agent_may_request: true }
  store.design.post:            { autonomy: manual, agent_may_request: true }
  council.placement.request:    { autonomy: manual, agent_may_request: true }
  profile.update:               { autonomy: manual, agent_may_request: true }
  meeting.book:                 { autonomy: manual, agent_may_request: true }
  # In-world life: on its own, recorded.
  world.move:                   { autonomy: autonomous }
  world.chat:                   { autonomy: autonomous }
  zeke.ask:                     { autonomy: autonomous }
  broker.negotiate:             { autonomy: autonomous, agent_may_request: true }   # propose/counter only; the deal itself is a transfer
  meeting.join:                 { autonomy: autonomous }
  hubid.read:                   { autonomy: autonomous }
  # Agent Village rows, same names and defaults.
  intent.publish.*:             { autonomy: manual, agent_may_request: true }
  intent.publish.stated.index:  { autonomy: autonomous, agent_may_request: true }
  opportunity.accept:           { autonomy: autonomous, agent_may_request: true }
  message.send:                 { autonomy: autonomous }
  network.call:                 { autonomy: autonomous }
  read.web:                     { autonomy: autonomous }
  # The owner only.
  city.launch:                  { autonomy: human-only }
  account.credential:           { autonomy: human-only }
  policy.core:                  { autonomy: human-only }
  log.mutate:                   { autonomy: human-only }

tools:
  - { match: "hubid_read_*",        class: hubid.read }
  - { match: hubid_send_ven,        class: ven.send }
  - { match: hubid_update_profile,  class: profile.update }
  - { match: city_claim_parcel,     class: parcel.claim }
  - { match: city_transfer_parcel,  class: parcel.transfer.p2p }
  - { match: city_broker_offer,     class: broker.negotiate }
  - { match: city_move,             class: world.move }
  - { match: city_say,              class: world.chat }
  - { match: zeke_ask,              class: zeke.ask }
  - { match: store_post_design,     class: store.design.post }
  - { match: send_message,          class: message.send }
  - { match: web_search,            class: read.web }
  - { match: "mcp__index__create_intent",      class: intent.publish.stated.index }
  - { match: "mcp__index__accept_opportunity", class: opportunity.accept }
  - { match: "mcp__index__reject_opportunity", class: opportunity.accept }
  - { match: "mcp__index__*",                  class: network.call }
\`\`\`
`;
