# Security policy

This package is a locally prepared public-release candidate; no public
repository, release, or npm publication exists yet. It is observe-only and
must remain CPU-only and local-only: no network, filesystem persistence,
subprocesses, session mutation, request mutation, permission mutation, tool
registration, or model-routing changes are in scope.

## Reporting

Do not include prompt text, message bodies, tool arguments, AGENTS contents,
absolute paths, credentials, or production session exports in a report. Until
the planned `030611/dsh-context-provenance` repository exists and publishes a
contact channel, there is no public security contact or disclosure process.
Use the future repository owner's established private channel and provide the
smallest reproduction that demonstrates the issue.

## Privacy boundary

The report intentionally withholds raw plugin entry/module identifiers, raw
AGENTS paths, and raw skill source/provider identifiers. It still exposes
publicly observable values needed by the bounded report: provider/model names,
tool names, skill names, adjacent-request changed booleans, and plugin entry
count/order plus enabled/fiber/module-kind categories. These may be sensitive
when a deployment chooses sensitive names or when a local observer can link
adjacent observations. Treat inspect output as local session data.

`Observed`, `Estimated`, and `Unavailable` are evidence labels, not privacy
labels. In particular, `Estimated` token values remain heuristic and
`Unavailable` must not be filled in by inference.

## Supported baseline

The release candidate is audited against DeepSeek Harness commit
`47f943859bef60e4160492346772ded9b24f765a`. The package's peer ranges are
deliberately limited to the tested rc.5/rc.6 surface. A report affecting a
different runtime version should be treated as a compatibility investigation,
not evidence of support.
