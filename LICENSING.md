# Licensing

> **Draft — not legal advice.** This page explains the licence in plain
> language so the copyright holder can iterate on it. The binding text is
> [`LICENSE`](LICENSE). Where this page and `LICENSE` differ, `LICENSE` wins.
> Have a lawyer review before relying on it.

MakerLab Tools is **source-available**, not open source. The code is public
and licensed under the
[PolyForm Noncommercial License 1.0.0](https://polyformproject.org/licenses/noncommercial/1.0.0)
(see [`LICENSE`](LICENSE)).

```
Required Notice: Copyright (c) 2026 Isaac Steinberg (https://github.com/philosophercode)
```

## In one paragraph

Anyone may read, run, fork and modify this software for a noncommercial
purpose. Schools, universities, public research organisations, charities and
government bodies may use it regardless of how they are funded. Nobody may
sell it or run it as a paid service without a separate commercial licence
from the copyright holder, who reserves commercial rights for himself.

## What is allowed

- **Noncommercial use.** "Any noncommercial purpose is a permitted purpose."
- **Personal use.** "Personal use for research, experiment, and testing for
  the benefit of public knowledge, personal study, private entertainment,
  hobby projects, amateur pursuits, or religious observance, without any
  anticipated commercial application, is use for a permitted purpose."
- **Educational and research institutions.** "Use by any charitable
  organization, educational institution, public research organization, public
  safety or health organization, environmental protection organization, or
  government institution is use for a permitted purpose regardless of the
  source of funding or obligations resulting from the funding." A university
  makerspace running this for its students falls here.
- **Forks and modifications.** The licence grants the right "to make changes
  and new works based on the software for any permitted purpose."
- **Redistribution**, with or without changes, as long as every recipient also
  gets the licence terms (or its URL) and every `Required Notice:` line
  ("Notices" section).
- **Patents.** Users get a licence to any of the licensor's patent claims the
  software would otherwise infringe (ends if you sue claiming the software
  infringes a patent — "Patent Defense").

## What is not allowed

- **Selling the software**, or selling copies, forks or derivatives of it.
- **Offering it as a paid or commercial service** — hosting it for paying
  customers, bundling it into a commercial product, or using it inside a
  for-profit business where the use has an anticipated commercial application.
- **Sublicensing or transferring** your licence: "These terms do not allow you
  to sublicense or transfer any of your licenses to anyone else."
- **Removing the notices.** Copies must carry the terms and the
  `Required Notice:` line.

If you break the terms and are told in writing, you keep your licence only if
you come into compliance within 32 days ("Violations").

"Commercial" is not defined in the licence text. When in doubt, ask.

## Commercial licences

Want to use MakerLab Tools commercially — sell it, host it for paying
customers, or build it into a product? Contact the copyright holder:

**Isaac Steinberg — `<CONTACT-EMAIL — TO FILL IN>`**

### Dual licensing

The licence does not stop the licensor "from granting licenses to anyone
else" ("No Other Rights"). The copyright holder can therefore offer the same
code under separate commercial terms, and is building a commercial,
multi-tenant product on it. To keep that possible, outside contributions are
accepted only under the contributor licence agreement described in
[`CONTRIBUTING.md`](CONTRIBUTING.md) and [`CLA.md`](CLA.md).

## Your data is yours

The licence covers the **code** only. Everything a lab puts into its own
deployment — tool inventory, photos, manuals and SOPs, projects, member
records, usage logs — belongs to that lab. It is not covered by this licence,
the copyright holder claims no rights in it, and a lab can export it and take
it elsewhere.

## The Cornell Tech MakerLAB

The Cornell Tech MakerLAB, as an educational institution, is already covered
by the "Noncommercial Organizations" clause. A separate written grant confirming
its perpetual, royalty-free right to run, fork and modify the software is
drafted in
[`docs/makerlab-license-grant-DRAFT.md`](docs/makerlab-license-grant-DRAFT.md).

## Open questions before this is final

1. **Ownership.** Confirm the copyright is Isaac's to license — check Cornell's
   IP policy and any employment, assistantship or course terms under which the
   code was written. The README's "Who owns it" section names the MakerLAB and
   should be reworded to match whatever is decided.
2. **Past contributions.** Anyone else who has committed code needs to sign the
   CLA (or have their work re-written) before it can be commercially relicensed.
3. **Contact email** for commercial enquiries (placeholder above).
4. **CLA mechanism** — see [`CONTRIBUTING.md`](CONTRIBUTING.md).
5. **Third-party dependencies** keep their own licences; check none of them
   forbids this model.

## Options considered

| Licence | Trade-off |
|---|---|
| **PolyForm Noncommercial 1.0.0** (chosen) | Short, plain, explicitly covers universities and research orgs; bars all commercial use, so it is not OSI open source and some companies will not touch it. |
| PolyForm Shield 1.0.0 | Allows commercial use except competing with the licensor; friendlier to adopters but lets others monetise it, and "compete" is fuzzy while Blueprint's scope is still forming. |
| Elastic License 2.0 | Well known; blocks offering it as a hosted/managed service and removing licence keys, but permits other commercial use such as selling a fork you run yourself internally. |
| Business Source License 1.1 | Noncommercial (or custom "Additional Use Grant") now, converts to an open licence after a set date (≤ 4 years); good for goodwill, but the code eventually becomes freely commercial. |
| AGPL-3.0 + commercial licence | Real open source, strong network copyleft deters closed SaaS forks; but anyone may sell or host it if they publish their changes, so it does not reserve commercial use to Isaac. |
