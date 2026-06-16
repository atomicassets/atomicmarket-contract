# Royalty Splits

By default, the collection fee share of every settlement is paid to the collection author.
With a **royalty split config**, the author can instead distribute it across three weighted
categories:

1. **Founders** — a global recipient list applying to every settlement of the collection
2. **Templates** — recipient lists keyed by the sold/rented asset's `template_id`
3. **Attributes** — rules that match an attribute `(field, value)` on the asset

Everything in this system is configured by — and only by — the **collection author**.
Authorized accounts of the collection are deliberately rejected: this configuration controls
where funds are paid out, so only the collection's highest authority may change it.

## Quick start

```sh
# 1. Create the config: founders alice (25%) + bob (75%), equal category weights, merged mode
cleos push action atomicmarket setroyalconf '{
  "collection_name": "mycollection",
  "founders": [{"recipient": "alice", "weight": 1}, {"recipient": "bob", "weight": 3}],
  "attribute_mode": 0,
  "split_founders": 1, "split_templates": 1, "split_attributes": 1
}' -p author@active

# 2. Template royalties for template 42
cleos push action atomicmarket settemplroy '{
  "collection_name": "mycollection", "template_id": 42,
  "recipients": [{"recipient": "artist", "weight": 1}]
}' -p author@active

# 3. An attribute rule: legendary assets pay the legendary designer
cleos push action atomicmarket setattrroy '{
  "collection_name": "mycollection", "source": 0,
  "field": "rarity", "value": ["string", "legendary"],
  "rule_weight": 1,
  "recipients": [{"recipient": "designer", "weight": 1}]
}' -p author@active
```

## Tables

| Table | Scope | Contents |
|---|---|---|
| `royaltyconf` | contract | per-collection config: founders list, attribute_mode, category split weights |
| `royaltytemp` | collection | per-template recipient lists |
| `royaltyattr` | collection | attribute rules: source, field, value, rule weight, recipients, lookup hash |

All recipient lists are `(recipient, weight)` pairs: at most 64 entries, no duplicates,
weights > 0, every recipient must be an existing account.

## Actions

| Action | Effect |
|---|---|
| `setroyalconf(collection_name, founders, attribute_mode, split_founders, split_templates, split_attributes)` | Create/update the config. At least one split weight must be > 0; `founders` must be empty iff `split_founders` is 0 |
| `delroyalconf(collection_name)` | Delete the config (template and attribute royalties must be deleted first). The fee then goes to the author again |
| `settemplroy(collection_name, template_id, recipients)` | Create/update a template's recipients (the template must exist) |
| `deltemplroy(collection_name, template_id)` | Delete a template's recipients |
| `setattrroy(collection_name, source, field, value, rule_weight, recipients)` | Create/update an attribute rule. Upserts by exact `(source, field, value)` triple |
| `delattrroy(collection_name, rule_id)` | Delete an attribute rule |

The authorizing author pays the RAM for all rows.

## Attribute rules

A rule matches an asset when the asset has an attribute with the rule's exact **field, value
and value type** — `uint32(5)` and `int32(5)` are different keys, so a rule only matches the
type the schema actually deserializes to. Float and vector typed values cannot be used as
match keys.

### Data sources and attribute_mode

Attribute data for an asset can come from four serialized blobs:

| Source | Data |
|---|---|
| 1 | Asset immutable data |
| 2 | Asset mutable data |
| 3 | Template immutable data |
| 4 | Template mutable data (AtomicAssets V2) |
| 0 | The merged union of all of the above |

`attribute_mode` in the config decides how rules are keyed:

- **Mode 0 (merged)**: all sources are merged into one attribute map and rules use
  `source = 0`. When a field exists in multiple sources, the precedence is:
  **asset immutable > asset mutable > template immutable > template mutable** — the same
  order as the source ids 1–4 above.
- **Mode 1 (granular)**: every source keeps its own attribute map and rules target a
  specific source (1–4).

The two modes occupy disjoint lookup keys, so **attribute_mode is locked while rules
exist** — delete all rules before flipping it.

Rule ids are allocated from a persistent counter and are never reused, so action histories
built from the log actions stay unambiguous.

## Settlement math

At settlement, the collection fee amount (see [collection fee](V2-Changes)) is distributed:

1. **Per asset**: the amount is divided equally across the listing's assets (V2 listings
   always have exactly one; legacy bundles drain through this path).
2. **Category renormalization**: for each asset, only categories that actually have payees
   participate — founders (config non-empty), templates (the asset's template has a
   recipient list), attributes (at least one rule matched). The split weights are
   renormalized across the participating categories, so no funds are ever stranded.
3. **Within the attributes category**: the category share is first split across the matched
   rules proportional to their `rule_weight`, then each rule's share is split across its
   recipients by weight. This two-level split means a rule configured as `9000/1000`
   cannot swamp a rule configured as `3/1`.
4. **Dust**: all integer rounding remainders, and the shares of assets for which no category
   matched, go to the collection author. The sum of all payouts always equals the collection
   fee exactly.

All amounts accrue to the internal `balances` table; recipients claim them with `withdraw`.
**No inline transfers are pushed to recipients** — a recipient contract that asserts in a
transfer handler can therefore never block a collection's settlements.

## Log actions

Every settlement through a royalty config emits inline log actions carrying the exact
amounts credited to balances:

| Action | Emitted | Payload |
|---|---|---|
| `logroyfound` | once per asset with founders payouts | collection, asset_id, payouts |
| `logroytempl` | once per asset with template payouts | collection, asset_id, template_id, payouts |
| `logroyattr` | once per matched rule with payouts | collection, asset_id, rule_id, payouts |
| `logroydust` | once per settlement, if anything fell through to the author | collection, author, amount |

The four logs of one settlement always sum to exactly the collection fee. The logs notify
nobody (`require_recipient` is deliberately not used — see above); indexers consume them
from action traces.
