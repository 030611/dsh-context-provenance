# Public release-candidate checklist

This checklist prepares a publishable candidate locally only. Do not create a
repository, push, tag, create a release, or run `npm publish` in this pass.
`private: false` and `publishConfig.access: public` are packaging eligibility,
not evidence of publication. Do not add `repository`, `homepage`, or `bugs`
metadata until the planned `030611/dsh-context-provenance` repository exists;
when it does, those fields may point only there.

## Before the local commit

- [ ] Confirm the official checkout is at `47f943859bef60e4160492346772ded9b24f765a` and clean.
- [ ] Confirm the candidate worktree is clean before the intended changes.
- [ ] Do not change `version`, public provenance/API shapes, or peer ranges for this hardening pass.
- [ ] Confirm `dsh.plugin.json`, `cordis.patch.yml`, package exports, and the exact rc.5/rc.6 peer ranges still match the audited package surface.
- [ ] Confirm raw prompt/system/tool-schema bodies, plugin identifiers, AGENTS paths, and skill source/provider identifiers remain withheld.
- [ ] Confirm only the documented residual values remain: provider/model/tool/skill names, adjacent changed booleans, and plugin entry count/order with safe categories.

## Gate

- [ ] CI pins Node `24.19.0` and pnpm `11.7.0`; record the actual local executor versions alongside any local frozen-install result.
- [ ] Run `pnpm run check` (lint, typecheck, tests, build, built smoke, official HEAD/patch smoke, publint, and temporary tarball package-name import).
- [ ] Verify the tarball smoke uses a temporary directory and leaves no tarball in the worktree.
- [ ] Review `git diff --check`, `git status --short`, and the resulting local commit.

## CI boundary

`.github/workflows/ci.yml` is deliberately read-only (`contents: read`) and
runs the same frozen install plus `pnpm run check`. It is not evidence that CI
has run until a repository host executes it. This local candidate does not
create, configure, or contact a GitHub repository.
